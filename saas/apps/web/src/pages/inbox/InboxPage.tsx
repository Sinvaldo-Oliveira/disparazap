import { ArrowLeft, Bot, CircleAlert, Info, PanelRightOpen, Search, SendHorizontal, StickyNote, Tags, UserRound, WifiOff, Workflow, X } from 'lucide-react';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Link, useMatch } from 'react-router';
import {
  INBOX_CONTROL_LABELS,
  type SocialAccount,
  INBOX_LIMITS,
  INBOX_ROUTE,
  inboxConversationRoute,
  inboxDetailsRoute,
  type InboxChannelsResponse,
  type InboxConversation,
  type InboxConversationDetail,
  type SocialInboxConversation,
  type InboxMessage,
} from '@disparazap/contracts';
import type { NavigationItem } from '../../app/navigation';
import { PlatformBadge, platformLabel } from '../../components/PlatformBadge';
import type { SocialApi } from '../../social/social-api';
import { useSession } from '../../auth/AuthProvider';
import { Card } from '../../components/Card';
import { PageHeader } from '../../components/PageHeader';
import type { InboxApi, InboxLiveStatus } from '../../inbox/inbox-api';
import { ChannelIcon, MessageContent, MessageStatusIcon, authorLabel, contactLabel, dateTime, dayLabel, initials, listTime, messageTime } from '../../inbox/inbox-ui';
import { newRequestId } from '../social/SocialComposer';
import { SocialChat, SocialConversationList, SocialDetails, SocialUnsupported, socialContactName, type SocialAccountRef, type SocialEntry } from '../../inbox/SocialInbox';
import { formatPhone } from '../WhatsAppPage';

export const INBOX_DESCRIPTION = 'Centralize suas conversas e atenda seus clientes pelo WhatsApp, Instagram e outros canais em um só lugar.';

type ListFilter = 'all' | 'unread' | 'open' | 'closed';
const FILTERS: readonly { value: ListFilter; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'unread', label: 'Não lidas' },
  { value: 'open', label: 'Abertas' },
  { value: 'closed', label: 'Encerradas' },
];

/** Com os avisos em tempo real ligados, ainda confere tudo a cada minuto (aviso perdido numa queda) */
const SAFETY_REFRESH_MS = 60_000;

export interface InboxPageProps {
  item: NavigationItem;
  api: InboxApi;
  /** Contas das redes na Zernio: viram os ícones de canal (só as ativas) */
  socialApi?: SocialApi;
  /** Consulta periódica enquanto o canal em tempo real está fora (os testes usam um valor curto) */
  pollMs?: number;
  /** Espera depois da última tecla na busca (os testes usam 0) */
  searchDelayMs?: number;
}

/** Inbox multicanal, etapa I1: WhatsApp (PLANO_MODULO_INBOX). Empresa e permissões vêm da sessão, conferidas na API. */
export function InboxPage({ item, api, socialApi, pollMs = 5000, searchDelayMs = 300 }: InboxPageProps) {
  const session = useSession();
  if (!session.organization || session.organization.role === 'viewer') {
    return (
      <>
        <PageHeader title={item.label} icon={item.icon} description={INBOX_DESCRIPTION} />
        <Card title={session.organization ? 'Sem acesso à Inbox' : 'Sem empresa nesta conta'}>
          <p className="card__text">
            {session.organization
              ? 'A Inbox é usada pelo dono, pelos administradores e pelos atendentes da empresa. Peça acesso ao dono da empresa.'
              : 'As conversas pertencem às empresas. Sua conta não está ligada a uma empresa.'}
          </p>
        </Card>
      </>
    );
  }
  return <InboxWorkspace item={item} api={api} {...(socialApi ? { socialApi } : {})} pollMs={pollMs} searchDelayMs={searchDelayMs} />;
}

/** Abas aplicadas às conversas de rede (as de WhatsApp continuam filtradas pelo servidor) */
const matchesSocialTab = (conversation: SocialInboxConversation, tab: ListFilter) =>
  tab === 'all' || (tab === 'unread' ? (conversation.unreadCount ?? 0) > 0 : tab === 'open' ? !conversation.archived : conversation.archived);

/** Canal = "whatsapp" ou "social:<id da conta na Zernio>" (as redes ainda não têm conversas nesta etapa) */
const SOCIAL_CHANNEL_PREFIX = 'social:';
/** Redes cuja lista de conversas é lida pela Zernio (TikTok autorizado em 2026-11-05; mensagens e respostas só no Instagram) */
const LIST_NETWORKS: readonly string[] = ['instagram', 'tiktok'];

function mergeMessages(current: InboxMessage[], fresh: InboxMessage[]): InboxMessage[] {
  // A releitura traz as últimas mensagens: as mais antigas já carregadas ("ver anteriores") continuam na tela
  const ids = new Set(fresh.map((message) => message.id));
  const oldest = fresh[0]?.sentAt;
  const older = oldest ? current.filter((message) => !ids.has(message.id) && message.sentAt < oldest) : [];
  return [...older, ...fresh];
}

function InboxWorkspace({ item, api, socialApi, pollMs, searchDelayMs }: Required<Omit<InboxPageProps, 'socialApi'>> & Pick<InboxPageProps, 'socialApi'>) {
  const session = useSession();
  // Diagnóstico temporário das datas (Z2.4): só dono e administradores
  const canManageInbox = session.organization?.role === 'owner' || session.organization?.role === 'admin';
  // Responder: dono, administrador e atendente (operator); visualizador só lê (regra do servidor também)
  const canReplySocial = canManageInbox || session.organization?.role === 'operator';
  const detailsMatch = useMatch(`${INBOX_ROUTE}/:conversationId/detalhes`);
  const chatMatch = useMatch(`${INBOX_ROUTE}/:conversationId`);
  const selectedId = detailsMatch?.params.conversationId ?? chatMatch?.params.conversationId ?? null;
  const view = detailsMatch ? 'details' : selectedId ? 'chat' : 'list';

  const [channels, setChannels] = useState<InboxChannelsResponse | null>(null);
  const [channelsError, setChannelsError] = useState<string | null>(null);
  const [channelFilter, setChannelFilter] = useState<string>('');
  // Contas das redes na Zernio: só as ativas (estado "ok") viram ícones
  const [socialAccounts, setSocialAccounts] = useState<SocialAccount[]>([]);
  useEffect(() => {
    if (!socialApi) return;
    const controller = new AbortController();
    void socialApi.accounts(controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setSocialAccounts(result.ok ? result.data.accounts.filter((account) => account.state === 'ok') : []);
    });
    return () => controller.abort();
  }, [socialApi]);
  // Conversa de rede escolhida (Z2.2): guarda a conta junto, para histórico e detalhes; trocar de canal a fecha
  const [socialSelected, setSocialSelected] = useState<SocialEntry | null>(null);
  useEffect(() => setSocialSelected(null), [channelFilter]);
  // "Todos os canais": conversas de cada conta do Instagram, lidas da Zernio só quando a visão unificada está aberta
  const [socialAll, setSocialAll] = useState<SocialEntry[] | null>(null);
  const [socialErrors, setSocialErrors] = useState<string[]>([]);
  useEffect(() => {
    if (channelFilter === 'whatsapp' || channelFilter.startsWith(SOCIAL_CHANNEL_PREFIX)) return;
    const instagram = socialAccounts.filter((account) => account.platform === 'instagram');
    if (!instagram.length) {
      setSocialAll([]);
      return;
    }
    const controller = new AbortController();
    void Promise.all(
      instagram.map(async (account) => {
        const ref: SocialAccountRef = { id: account.id, platform: account.platform, name: account.username ? `@${account.username}` : (account.displayName ?? 'Conta') };
        const result = await api.socialConversations(account.id, null, controller.signal);
        if (!result.ok) return { entries: [] as SocialEntry[], error: `${ref.name}: ${result.message}` };
        return { entries: result.data.conversations.map((conversation) => ({ account: ref, conversation })), error: null };
      }),
    ).then((results) => {
      if (controller.signal.aborted) return;
      setSocialAll(results.flatMap((result) => result.entries));
      setSocialErrors(results.flatMap((result) => (result.error ? [result.error] : [])));
    });
    return () => controller.abort();
  }, [api, socialAccounts, channelFilter]);
  const socialChannel = channelFilter.startsWith(SOCIAL_CHANNEL_PREFIX) ? (socialAccounts.find((account) => `${SOCIAL_CHANNEL_PREFIX}${account.id}` === channelFilter) ?? null) : null;
  const socialRef = socialChannel ? { id: socialChannel.id, platform: socialChannel.platform, name: socialChannel.username ? `@${socialChannel.username}` : (socialChannel.displayName ?? 'Conta') } : null;
  const [accountId, setAccountId] = useState('');
  const [filter, setFilter] = useState<ListFilter>('all');
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [list, setList] = useState<InboxConversation[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [detail, setDetail] = useState<InboxConversationDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [live, setLive] = useState<InboxLiveStatus>('down');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const pendingSend = useRef<{ conversationId: string; text: string; requestId: string } | null>(null);
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;

  useEffect(() => {
    const timer = setTimeout(() => setTerm(search.trim()), searchDelayMs);
    return () => clearTimeout(timer);
  }, [search, searchDelayMs]);

  const query = useMemo(
    () => ({ filter, ...(channelFilter === 'whatsapp' ? { channel: 'whatsapp' as const } : {}), ...(accountId && !accountId.startsWith(SOCIAL_CHANNEL_PREFIX) ? { accountId } : {}), ...(term ? { search: term } : {}) }),
    [filter, channelFilter, accountId, term],
  );

  const loadChannels = useCallback(
    async (signal?: AbortSignal) => {
      const result = await api.channels(signal);
      if (signal?.aborted) return;
      if (!result.ok) return setChannelsError(result.message);
      setChannelsError(null);
      setChannels(result.data);
    },
    [api],
  );

  const loadList = useCallback(
    async (signal?: AbortSignal) => {
      const result = await api.conversations(query, signal);
      if (signal?.aborted) return;
      if (!result.ok) return setListError(result.message);
      setListError(null);
      setList(result.data.conversations);
    },
    [api, query],
  );

  const loadDetail = useCallback(
    async (id: string, signal?: AbortSignal) => {
      const result = await api.conversation(id, null, signal);
      if (signal?.aborted || selectedRef.current !== id) return;
      if (!result.ok) {
        setDetailError(result.message);
        if (result.status === 404) setDetail(null);
        return;
      }
      setDetailError(null);
      setDetail((current) => (current && current.conversation.id === id ? { ...result.data, messages: mergeMessages(current.messages, result.data.messages) } : result.data));
      // Aberta no painel: zera as não lidas (no DisparaZap; o contato não recebe confirmação de leitura)
      if (result.data.conversation.unreadCount > 0) {
        const read = await api.markRead(id);
        if (read.ok) {
          setList((current) => current?.map((conversation) => (conversation.id === id ? { ...conversation, unreadCount: 0 } : conversation)) ?? current);
          setDetail((current) => (current && current.conversation.id === id ? { ...current, conversation: { ...current.conversation, unreadCount: 0 } } : current));
        }
      }
    },
    [api],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadChannels(controller.signal);
    return () => controller.abort();
  }, [loadChannels]);

  useEffect(() => {
    const controller = new AbortController();
    void loadList(controller.signal);
    return () => controller.abort();
  }, [loadList]);

  useEffect(() => {
    setDraft('');
    setSendError(null);
    setDetailError(null);
    if (!selectedId) return setDetail(null);
    const controller = new AbortController();
    setDetail((current) => (current?.conversation.id === selectedId ? current : null));
    void loadDetail(selectedId, controller.signal);
    return () => controller.abort();
  }, [selectedId, loadDetail]);

  // Avisos em tempo real (só ids): relê a lista e, se for a conversa aberta, o histórico
  const refreshAll = useCallback(() => {
    void loadList();
    void loadChannels();
    if (selectedRef.current) void loadDetail(selectedRef.current);
  }, [loadList, loadChannels, loadDetail]);
  const handlers = useRef({ refreshAll, loadList, loadChannels, loadDetail });
  handlers.current = { refreshAll, loadList, loadChannels, loadDetail };

  useEffect(() => {
    let readyOnce = false;
    let listTimer: ReturnType<typeof setTimeout> | null = null;
    const subscription = api.subscribe(
      (event) => {
        if (event.type === 'ready') {
          // Reconectou: confere o que pode ter chegado enquanto o canal estava fora
          if (readyOnce) handlers.current.refreshAll();
          readyOnce = true;
          return;
        }
        if (event.type === 'reception') return void handlers.current.loadChannels();
        if (listTimer) clearTimeout(listTimer);
        listTimer = setTimeout(() => {
          void handlers.current.loadList();
          void handlers.current.loadChannels();
        }, 150);
        if (event.conversationId && event.conversationId === selectedRef.current) void handlers.current.loadDetail(event.conversationId);
      },
      setLive,
    );
    return () => {
      if (listTimer) clearTimeout(listTimer);
      subscription.close();
    };
  }, [api]);

  // Consulta periódica: frequente sem o canal em tempo real; de minuto em minuto com ele
  useEffect(() => {
    const timer = setInterval(() => handlers.current.refreshAll(), live === 'up' ? SAFETY_REFRESH_MS : pollMs);
    return () => clearInterval(timer);
  }, [live, pollMs]);

  async function loadOlder() {
    if (!detail || !selectedId) return;
    const before = detail.messages[0]?.sentAt;
    if (!before) return;
    setLoadingOlder(true);
    const result = await api.conversation(selectedId, before);
    setLoadingOlder(false);
    if (!result.ok) return setDetailError(result.message);
    setDetail((current) => (current && current.conversation.id === selectedId ? { ...current, hasMore: result.data.hasMore, messages: [...result.data.messages, ...current.messages] } : current));
  }

  async function send(event?: FormEvent) {
    event?.preventDefault();
    const text = draft.trim();
    if (!selectedId || !text || sending) return;
    if (text.length > INBOX_LIMITS.textMax) return setSendError(`Use no máximo ${INBOX_LIMITS.textMax} caracteres.`);
    // Repetir depois de uma falha de rede usa o mesmo pedido: a API nunca envia duas vezes
    const previous = pendingSend.current;
    const requestId = previous && previous.conversationId === selectedId && previous.text === text ? previous.requestId : newRequestId();
    pendingSend.current = { conversationId: selectedId, text, requestId };
    setSending(true);
    setSendError(null);
    const result = await api.send(selectedId, { requestId, text });
    setSending(false);
    if (!result.ok) return setSendError(result.message);
    pendingSend.current = null;
    if (selectedRef.current === selectedId) setDraft('');
    const sent = result.data.message;
    setDetail((current) => (current && current.conversation.id === selectedId ? { ...current, messages: [...current.messages.filter((message) => message.id !== sent.id), sent] } : current));
    void loadList();
    void loadDetail(selectedId);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter envia; Shift+Enter quebra a linha
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    }
  }

  const conversation = detail?.conversation.id === selectedId ? detail.conversation : (list?.find((item) => item.id === selectedId) ?? null);
  const enabledChannels = channels?.channels.filter((channel) => channel.inboxEnabledAt) ?? [];
  const totalUnread = channels?.channels.reduce((sum, channel) => sum + channel.unreadCount, 0) ?? 0;

  const socialAccountFilter = accountId.startsWith(SOCIAL_CHANNEL_PREFIX) ? accountId.slice(SOCIAL_CHANNEL_PREFIX.length) : null;
  const showWhatsApp = (channelFilter === '' || channelFilter === 'whatsapp') && socialAccountFilter === null;
  const showSocial = channelFilter === '' && (accountId === '' || socialAccountFilter !== null);
  const socialRows = showSocial && socialAll
    ? socialAll.filter((entry) => (socialAccountFilter === null || entry.account.id === socialAccountFilter) && matchesSocialTab(entry.conversation, filter) && (term === '' || socialContactName(entry.conversation).toLowerCase().includes(term.toLowerCase())))
    : [];
  const whatsappRows = showWhatsApp && list ? list : [];
  const rows = [
    ...whatsappRows.map((item) => ({ kind: 'whatsapp' as const, time: Date.parse(item.lastMessageAt ?? '') || 0, item })),
    ...socialRows.map((entry) => ({ kind: 'social' as const, time: Date.parse(entry.conversation.updatedAt ?? '') || 0, entry })),
  ].sort((a, b) => b.time - a.time);

  return (
    <div className="inbox-page">
      <PageHeader title={item.label} icon={item.icon} description={INBOX_DESCRIPTION} />
      {(channelFilter === '' || channelFilter === 'whatsapp') && <ReceptionNotice channels={channels} error={channelsError} enabledCount={enabledChannels.length} live={live} />}

      <div className="inbox" data-view={socialSelected ? 'chat' : view}>
        {/* ----- Coluna 1: canais, filtros e conversas ----- */}
        <section className="inbox__list" aria-label="Conversas">
          <div className="inbox__channels" role="group" aria-label="Filtrar por canal">
            <button type="button" className={`inbox-chip${channelFilter === '' ? ' inbox-chip--active' : ''}`} aria-pressed={channelFilter === ''} aria-label="Todos os canais" onClick={() => setChannelFilter('')}>
              Todos
            </button>
            <button type="button" className={`channel-button${channelFilter === 'whatsapp' ? ' channel-button--active' : ''}`} aria-pressed={channelFilter === 'whatsapp'} aria-label="WhatsApp" title="WhatsApp" onClick={() => setChannelFilter('whatsapp')}>
              <ChannelIcon decorative />
              {totalUnread > 0 && <span className="unread-badge channel-button__badge" aria-label={`${totalUnread} não lidas`}>{totalUnread}</span>}
            </button>
            {socialAccounts.map((account) => {
              const value = `${SOCIAL_CHANNEL_PREFIX}${account.id}`;
              const name = `${platformLabel(account.platform)}${account.username ? ` @${account.username}` : ''}`;
              return (
                <button key={account.id} type="button" className={`channel-button${channelFilter === value ? ' channel-button--active' : ''}`} aria-pressed={channelFilter === value} aria-label={name} title={name} onClick={() => setChannelFilter(value)}>
                  <PlatformBadge platform={account.platform} small />
                </button>
              );
            })}
          </div>
          {!socialRef && (
          <div className="inbox__filters">
            <div className="search-field inbox__search">
              <Search aria-hidden="true" />
              <input type="search" className="field__input" aria-label="Buscar conversa por nome ou número" placeholder="Buscar por nome ou número" maxLength={INBOX_LIMITS.searchMax} value={search} onChange={(event) => setSearch(event.target.value)} />
            </div>
            <select className="field__input field__input--small" aria-label="Filtrar por conta" value={accountId} onChange={(event) => setAccountId(event.target.value)}>
              <option value="">Todas as contas</option>
              {socialAccounts.filter((account) => LIST_NETWORKS.includes(account.platform)).map((account) => (
                <option key={account.id} value={`${SOCIAL_CHANNEL_PREFIX}${account.id}`}>{`${account.platform === 'tiktok' ? 'TikTok' : 'Instagram'} ${account.username ? `@${account.username}` : ''}`}</option>
              ))}
              {channels?.channels.map((channel) => (
                <option key={channel.id} value={channel.id}>{channel.name}{channel.phone ? ` · ${formatPhone(channel.phone)}` : ''}</option>
              ))}
            </select>
            <div className="inbox__tabs" role="group" aria-label="Filtrar conversas">
              {FILTERS.map((option) => (
                <button key={option.value} type="button" className={`inbox__tab${filter === option.value ? ' inbox__tab--active' : ''}`} aria-pressed={filter === option.value} onClick={() => setFilter(option.value)}>
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          )}

          {socialRef && LIST_NETWORKS.includes(socialRef.platform) && (
            <SocialConversationList account={socialRef} api={api} selectedId={socialSelected?.conversation.id ?? null} onSelect={(conversation) => { if (socialRef.platform === 'instagram') setSocialSelected({ account: socialRef, conversation }); }} canDiagnose={canManageInbox && socialRef.platform === 'instagram'} />
          )}
          {socialRef && !LIST_NETWORKS.includes(socialRef.platform) && <SocialUnsupported account={socialRef} />}
          {!socialRef && (
            <>
              {showWhatsApp && listError && <p className="auth-alert" role="alert">{listError}</p>}
              {showWhatsApp && !list && !listError && <p className="integration__loading" role="status">Carregando as conversas…</p>}
              {socialErrors.map((text) => (
                <p key={text} className="auth-alert" role="alert">{text}</p>
              ))}
              {rows.length === 0 && (list !== null || socialAll !== null) && (
                <p className="inbox__empty">{term || filter !== 'all' || accountId ? 'Nenhuma conversa com esses filtros.' : 'Nenhuma conversa ainda. As mensagens dos clientes aparecem aqui quando chegam.'}</p>
              )}
              {rows.length > 0 && (
                <ul className="conversation-list">
                  {rows.map((row) =>
                    row.kind === 'whatsapp' ? (
                      <li key={`w-${row.item.id}`}>
                        <Link to={inboxConversationRoute(row.item.id)} onClick={() => setSocialSelected(null)} className={`conversation-item${row.item.id === selectedId ? ' conversation-item--active' : ''}${row.item.unreadCount > 0 ? ' conversation-item--unread' : ''}`} aria-current={row.item.id === selectedId ? 'true' : undefined}>
                          <span className="avatar" aria-hidden="true">{initials(contactLabel(row.item.contact))}</span>
                          <span className="conversation-item__body">
                            <span className="conversation-item__top">
                              <strong className="conversation-item__name">{contactLabel(row.item.contact)}</strong>
                              <time className="conversation-item__time" dateTime={row.item.lastMessageAt ?? undefined}>{listTime(row.item.lastMessageAt)}</time>
                            </span>
                            <span className="conversation-item__bottom">
                              <ChannelIcon className="channel-icon--small" />
                              <span className="conversation-item__preview">
                                {row.item.lastMessageDirection === 'outbound' && <span className="conversation-item__you">Você: </span>}
                                {row.item.lastMessagePreview ?? ''}
                              </span>
                              {row.item.unreadCount > 0 && <span className="unread-badge" aria-label={`${row.item.unreadCount} não lidas`}>{row.item.unreadCount}</span>}
                            </span>
                            <span className="conversation-item__account">{row.item.accountName}{row.item.status === 'closed' ? ' · Encerrada' : ''}</span>
                          </span>
                        </Link>
                      </li>
                    ) : (
                      <li key={`s-${row.entry.conversation.id}`}>
                        <button type="button" className={`conversation-item${row.entry.conversation.id === socialSelected?.conversation.id ? ' conversation-item--active' : ''}${(row.entry.conversation.unreadCount ?? 0) > 0 ? ' conversation-item--unread' : ''}`} aria-pressed={row.entry.conversation.id === socialSelected?.conversation.id} onClick={() => setSocialSelected(row.entry)}>
                          <span className="avatar" aria-hidden="true">{initials(socialContactName(row.entry.conversation))}</span>
                          <span className="conversation-item__body">
                            <span className="conversation-item__top">
                              <strong className="conversation-item__name">{socialContactName(row.entry.conversation)}</strong>
                              <time className="conversation-item__time" dateTime={row.entry.conversation.updatedAt ?? undefined}>{listTime(row.entry.conversation.updatedAt)}</time>
                            </span>
                            <span className="conversation-item__bottom">
                              <PlatformBadge platform={row.entry.account.platform} small />
                              <span className="conversation-item__preview">{row.entry.conversation.lastMessage ?? 'Sem mensagens de texto'}</span>
                              {(row.entry.conversation.unreadCount ?? 0) > 0 && <span className="unread-badge" aria-label={`${row.entry.conversation.unreadCount} não lidas`}>{row.entry.conversation.unreadCount}</span>}
                            </span>
                            <span className="conversation-item__account">Conversa com cliente · {row.entry.account.name}</span>
                          </span>
                        </button>
                      </li>
                    ),
                  )}
                </ul>
              )}
            </>
          )}
        </section>

        {/* ----- Coluna 2: a conversa ----- */}
        <section className="inbox__chat" aria-label="Conversa">
          {socialSelected && <SocialChat account={socialSelected.account} api={api} conversation={socialSelected.conversation} onBack={() => setSocialSelected(null)} canReply={canReplySocial} />}
          {socialRef && socialRef.platform === 'instagram' && !socialSelected && <div className="inbox__placeholder"><p>Escolha uma conversa na lista.</p></div>}
          {socialRef && socialRef.platform === 'tiktok' && <div className="inbox__placeholder"><p>As conversas do TikTok aparecem na lista. As mensagens e as respostas ainda não estão habilitadas nesta etapa.</p></div>}
          {socialRef && !LIST_NETWORKS.includes(socialRef.platform) && <div className="inbox__placeholder"><p>Esta rede ainda não tem leitura de conversas nesta etapa.</p></div>}
          {!socialSelected && !socialRef && !selectedId && <div className="inbox__placeholder"><p>Escolha uma conversa na lista.</p></div>}
          {!socialSelected && !socialRef && selectedId && !conversation && detailError && (
            <div className="inbox__placeholder">
              <p className="auth-alert" role="alert">{detailError}</p>
              <Link className="text-link" to={INBOX_ROUTE}>Voltar para as conversas</Link>
            </div>
          )}
          {!socialSelected && !socialRef && selectedId && !conversation && !detailError && <p className="integration__loading" role="status">Carregando a conversa…</p>}
          {!socialSelected && !socialRef && selectedId && conversation && (
            <>
              <header className="chat__header">
                <Link to={INBOX_ROUTE} className="icon-button chat__back" aria-label="Voltar para as conversas">
                  <ArrowLeft aria-hidden="true" />
                </Link>
                <span className="avatar" aria-hidden="true">{initials(contactLabel(conversation.contact))}</span>
                <div className="chat__identity">
                  <h2 className="chat__name">{contactLabel(conversation.contact)}</h2>
                  <p className="chat__meta">
                    <ChannelIcon className="channel-icon--small" /> {conversation.contact.phone ? formatPhone(conversation.contact.phone) : 'Número não informado pelo WhatsApp'} · {conversation.accountName}
                  </p>
                </div>
                <Link to={view === 'details' ? inboxConversationRoute(conversation.id) : inboxDetailsRoute(conversation.id)} className="action-button chat__details-toggle" aria-label={view === 'details' ? 'Fechar detalhes do contato' : 'Ver detalhes do contato'}>
                  <PanelRightOpen aria-hidden="true" /> Detalhes
                </Link>
              </header>

              <ol className="chat__messages" aria-label="Mensagens" aria-live="polite">
                {detail?.hasMore && (
                  <li className="chat__older">
                    <button type="button" className="action-button" disabled={loadingOlder} onClick={() => void loadOlder()}>{loadingOlder ? 'Carregando…' : 'Ver mensagens anteriores'}</button>
                  </li>
                )}
                {(detail?.conversation.id === conversation.id ? detail.messages : []).map((message, index, all) => {
                  const day = dayLabel(message.sentAt);
                  const showDay = index === 0 || dayLabel(all[index - 1]?.sentAt ?? message.sentAt) !== day;
                  const author = authorLabel(message);
                  return (
                    <Fragment key={message.id}>
                      {showDay && <li className="chat__day"><span>{day}</span></li>}
                      <li className={`msg msg--${message.direction}${message.status === 'failed' ? ' msg--failed' : ''}`}>
                        {author && <span className="msg__author">{author}</span>}
                        <MessageContent message={message} />
                        <span className="msg__foot">
                          <time dateTime={message.sentAt}>{messageTime(message.sentAt)}</time>
                          <MessageStatusIcon status={message.status} />
                        </span>
                        {message.error && (
                          <span className="msg__error" role="note">
                            <CircleAlert aria-hidden="true" /> {message.error}
                          </span>
                        )}
                      </li>
                    </Fragment>
                  );
                })}
              </ol>

              {detailError && <p className="auth-alert" role="alert">{detailError}</p>}
              <form className="composer-bar" onSubmit={(event) => void send(event)} aria-label="Responder">
                <label className="sr-only" htmlFor="inbox-reply">Mensagem para {contactLabel(conversation.contact)}</label>
                <textarea
                  id="inbox-reply"
                  className="field__input composer-bar__input"
                  rows={2}
                  placeholder="Escreva a resposta (Enter envia; Shift+Enter quebra a linha)"
                  value={draft}
                  maxLength={INBOX_LIMITS.textMax}
                  disabled={!detail?.canSend}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={handleKeyDown}
                />
                <button type="submit" className="action-button action-button--primary composer-bar__send" disabled={sending || !draft.trim() || !detail?.canSend}>
                  <SendHorizontal aria-hidden="true" /> {sending ? 'Enviando…' : 'Enviar'}
                </button>
                {draft.length > INBOX_LIMITS.textMax - 200 && <span className="field__hint composer-bar__count">{draft.length} de {INBOX_LIMITS.textMax}</span>}
                {sendError && <p className="auth-alert composer-bar__error" role="alert">{sendError}</p>}
              </form>
            </>
          )}
        </section>

        {/* ----- Coluna 3: detalhes do contato ----- */}
        <aside className={`inbox__details${view === 'details' ? ' inbox__details--open' : ''}`} aria-label="Detalhes do contato">
          {socialSelected ? <SocialDetails account={socialSelected.account} conversation={socialSelected.conversation} /> : conversation ? (
            <>
              <div className="details__head">
                <h2>Detalhes</h2>
                <Link to={inboxConversationRoute(conversation.id)} className="icon-button details__close" aria-label="Fechar detalhes">
                  <X aria-hidden="true" />
                </Link>
              </div>
              <div className="details__contact">
                <span className="avatar avatar--large" aria-hidden="true">{initials(contactLabel(conversation.contact))}</span>
                <strong>{contactLabel(conversation.contact)}</strong>
                <span className="field__hint">{conversation.contact.phone ? formatPhone(conversation.contact.phone) : 'Número não informado pelo WhatsApp'}</span>
              </div>
              <dl className="details__facts">
                <dt>Canal</dt>
                <dd><ChannelIcon className="channel-icon--small" decorative /> WhatsApp</dd>
                <dt>Conta</dt>
                <dd>{conversation.accountName}</dd>
                <dt>Responsável</dt>
                <dd><UserRound aria-hidden="true" /> {conversation.assignedTo?.name ?? 'Sem responsável (fila)'}</dd>
                <dt>Modo</dt>
                <dd>{INBOX_CONTROL_LABELS[conversation.controlMode]}{conversation.status === 'closed' ? ' · Encerrada' : ''}</dd>
                {conversation.lastMessageAt && (
                  <>
                    <dt>Última mensagem</dt>
                    <dd>{dateTime(conversation.lastMessageAt)}</dd>
                  </>
                )}
              </dl>
              <ul className="details__future" aria-label="Em desenvolvimento">
                <li><Tags aria-hidden="true" /> Etiquetas <span className="badge badge--development">Em desenvolvimento</span></li>
                <li><StickyNote aria-hidden="true" /> Notas internas <span className="badge badge--development">Em desenvolvimento</span></li>
                <li><Bot aria-hidden="true" /> Agente de IA <span className="badge badge--development">Em desenvolvimento</span></li>
                <li><Workflow aria-hidden="true" /> Automações <span className="badge badge--development">Em desenvolvimento</span></li>
              </ul>
            </>
          ) : (
            <p className="inbox__empty"><Info aria-hidden="true" /> Os dados do contato aparecem aqui quando uma conversa é aberta.</p>
          )}
        </aside>
      </div>
    </div>
  );
}

/** Situação do recebimento: desligado, fora do ar, chave recusada, períodos sem recebimento, avisos em tempo real fora */
function ReceptionNotice({ channels, error, enabledCount, live }: { channels: InboxChannelsResponse | null; error: string | null; enabledCount: number; live: InboxLiveStatus }) {
  if (error) return <p className="auth-alert" role="alert">{error}</p>;
  if (!channels) return null;
  const notes: { key: string; text: ReactNode }[] = [];
  const state = channels.reception.state;
  if (state === 'disabled') {
    notes.push({ key: 'disabled', text: 'O recebimento de mensagens ainda não foi ligado nesta plataforma: ele é liberado depois da homologação com uma instância de teste. Até lá, a Inbox não recebe conversas novas.' });
  } else if (state === 'unavailable') {
    notes.push({ key: 'unavailable', text: 'A integração com o servidor de WhatsApp não está disponível agora. As conversas novas aparecem quando ela voltar.' });
  } else if (state === 'auth_failed') {
    notes.push({ key: 'auth', text: 'O servidor de WhatsApp recusou a chave da plataforma. O administrador da plataforma precisa conferir a chave em Configurações. Enquanto isso, mensagens novas não chegam.' });
  } else if (state === 'connecting' || state === 'reconnecting') {
    notes.push({ key: 'reconnecting', text: 'Reconectando ao servidor de WhatsApp… Mensagens que chegarem nesse intervalo podem demorar a aparecer.' });
  } else if (enabledCount === 0) {
    notes.push({
      key: 'none',
      text: (
        <>
          Nenhum número da empresa está recebendo mensagens na Inbox. {channels.canManage ? <>Ligue em <Link className="text-link" to="/integracoes#whatsapp">Integrações → WhatsApp</Link>.</> : 'Peça ao dono ou a um administrador da empresa.'}
        </>
      ),
    });
  }
  for (const gap of channels.gaps) {
    const name = channels.channels.find((channel) => channel.id === gap.accountId)?.name ?? 'WhatsApp';
    notes.push({
      key: `gap-${gap.accountId}-${gap.startedAt}`,
      text: gap.endedAt
        ? `${name}: o recebimento ficou fora do ar de ${dateTime(gap.startedAt)} a ${dateTime(gap.endedAt)}. Mensagens desse período podem não aparecer aqui; confira no celular.`
        : `${name}: o recebimento está interrompido desde ${dateTime(gap.startedAt)}. Mensagens desse período podem não aparecer aqui.`,
    });
  }
  return (
    <>
      {notes.length > 0 && (
        <div className="notice inbox__notice" role="status">
          <WifiOff className="notice__icon" aria-hidden="true" />
          <ul className="inbox__notes">
            {notes.map((note) => (
              <li key={note.key}>{note.text}</li>
            ))}
          </ul>
        </div>
      )}
      {state === 'connected' && enabledCount > 0 && live === 'down' && (
        <p className="field__hint inbox__live" role="status">Atualização automática a cada poucos segundos (avisos em tempo real indisponíveis).</p>
      )}
    </>
  );
}
