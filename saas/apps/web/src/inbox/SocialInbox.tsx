import { ArrowLeft, Info, LoaderCircle, Send } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { SOCIAL_REPLY_TEXT_MAX, socialReplyWindow, type SocialAttachmentType, type SocialDateDiagnostic, type SocialInboxConversation, type SocialInboxMessage } from '@disparazap/contracts';
import { PlatformBadge, platformLabel } from '../components/PlatformBadge';
import type { InboxApi } from './inbox-api';
import { dateTime, initials, listTime, messageTime } from './inbox-ui';

/** Conta de rede escolhida no ícone (Z2): só leitura nesta etapa */
export interface SocialAccountRef {
  id: string;
  platform: string;
  name: string;
}

/** Rótulo de cada tipo de anexo documentado pela Zernio (sem o arquivo: a URL expira) */
const ATTACHMENT_LABELS: Readonly<Record<SocialAttachmentType, string>> = {
  image: 'Imagem',
  video: 'Vídeo',
  audio: 'Áudio',
  file: 'Arquivo',
  sticker: 'Figurinha',
  share: 'Publicação compartilhada',
  template: 'Modelo',
  unsupported_type: 'Conteúdo não suportado pela visualização',
};

const contactName = (item: { contactName: string | null }) => item.contactName?.trim() || 'Contato sem nome';
const READ_ONLY_NOTE = 'Somente leitura: as respostas pelo Instagram chegam numa próxima etapa, depois da homologação das mensagens diretas.';

/** Coluna 1: conversas da conta escolhida, com "carregar mais" pela paginação da Zernio */
export function SocialConversationList({
  account,
  api,
  selectedId,
  onSelect,
  canDiagnose = false,
}: {
  account: SocialAccountRef;
  api: InboxApi;
  selectedId: string | null;
  onSelect: (conversation: SocialInboxConversation) => void;
  canDiagnose?: boolean;
}) {
  // Diagnóstico das datas (Z2.4): escolhido na lista, sem abrir a conversa (abrir carregaria a página de mensagens)
  const [diagTarget, setDiagTarget] = useState<string | null>(null);
  const [items, setItems] = useState<SocialInboxConversation[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setItems(null);
    setError(null);
    void api.socialConversations(account.id, null, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (!result.ok) return setError(result.message);
      setItems(result.data.conversations);
      setCursor(result.data.nextCursor);
      setHasMore(result.data.hasMore);
    });
    return () => controller.abort();
  }, [api, account.id]);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    const result = await api.socialConversations(account.id, cursor);
    setLoadingMore(false);
    if (!result.ok) return setError(result.message);
    setItems((current) => [...(current ?? []), ...result.data.conversations]);
    setCursor(result.data.nextCursor);
    setHasMore(result.data.hasMore);
  }

  return (
    <>
      <div className="social-inbox__head social-inbox__head--account">
        <span className="social-inbox__label">Conta conectada</span>
        <PlatformBadge platform={account.platform} small />
        <strong>{account.name}</strong>
      </div>
      <p className="field__hint social-inbox__note">{READ_ONLY_NOTE}</p>
      {canDiagnose && diagTarget && <SocialDateDiagnosticPanel api={api} conversationId={diagTarget} accountId={account.id} />}
      {error && <p className="auth-alert" role="alert">{error}</p>}
      {!items && !error && <p className="integration__loading" role="status">Carregando as conversas…</p>}
      {items && items.length === 0 && <p className="inbox__empty">Nenhuma conversa nesta conta ainda.</p>}
      {items && items.length > 0 && (
        <ul className="conversation-list">
          {items.map((item) => {
            const name = contactName(item);
            return (
              <li key={item.id}>
                <button type="button" className={`conversation-item${item.id === selectedId ? ' conversation-item--active' : ''}${(item.unreadCount ?? 0) > 0 ? ' conversation-item--unread' : ''}`} aria-pressed={item.id === selectedId} onClick={() => onSelect(item)}>
                  <span className="avatar" aria-hidden="true">{initials(name)}</span>
                  <span className="conversation-item__body">
                    <span className="conversation-item__top">
                      <strong className="conversation-item__name">{name}</strong>
                      <time className="conversation-item__time" dateTime={item.updatedAt ?? undefined}>{listTime(item.updatedAt)}</time>
                    </span>
                    <span className="conversation-item__bottom">
                      <span className="conversation-item__preview">{item.lastMessage ?? 'Sem mensagens de texto'}</span>
                      {(item.unreadCount ?? 0) > 0 && <span className="unread-badge" aria-label={`${item.unreadCount} não lidas`}>{item.unreadCount}</span>}
                    </span>
                    <span className="conversation-item__account">{account.name}{item.archived ? ' · Arquivada' : ''}</span>
                  </span>
                </button>
                {canDiagnose && (
                  <button type="button" className="action-button social-inbox__diag" onClick={() => setDiagTarget(item.id)}>
                    Diagnosticar datas
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {hasMore && (
        <div className="social-inbox__more">
          <button type="button" className="action-button" disabled={loadingMore} onClick={() => void loadMore()}>
            {loadingMore ? 'Carregando…' : 'Carregar mais conversas'}
          </button>
        </div>
      )}
    </>
  );
}

/** Coluna 2: histórico da conversa escolhida (mais antigas primeiro; "ver anteriores" pela paginação) */
/** Atualização automática da conversa aberta (a Zernio é lida a cada intervalo; só com a aba visível) */
const SOCIAL_CHAT_REFRESH_MS = 15_000;

/** Junta a leitura mais recente com o histórico já carregado (mensagens antigas ficam em cima) */
export function mergeFreshMessages(current: SocialInboxMessage[], fresh: SocialInboxMessage[]): SocialInboxMessage[] {
  const freshIds = new Set(fresh.map((item) => item.id));
  const merged = [...current.filter((item) => !freshIds.has(item.id)), ...fresh];
  const unchanged = merged.length === current.length && merged.every((item, index) => item.id === current[index]?.id);
  return unchanged ? current : merged;
}

export function SocialChat({ account, api, conversation, onBack, canReply }: { account: SocialAccountRef; api: InboxApi; conversation: SocialInboxConversation; onBack: () => void; canReply: boolean }) {
  const [messages, setMessages] = useState<SocialInboxMessage[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [historyReliable, setHistoryReliable] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Rolagem acompanha o fim da conversa só quando a pessoa está perto do fim (não puxa quem lê o histórico)
  const pinned = useRef(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  // Mesma intenção enquanto o texto não muda: repetir após falha de rede não envia duas vezes (o servidor devolve o registro)
  const attempt = useRef<{ text: string; requestId: string } | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const restoreHeight = useRef<number | null>(null);
  const name = contactName(conversation);
  // Janela calculada só com histórico confirmado e com a última mensagem do contato à vista
  const lastIncoming = messages?.filter((item) => item.direction === 'incoming').reduce<string | null>((latest, item) => (item.sentAt && (!latest || item.sentAt > latest) ? item.sentAt : latest), null) ?? null;
  const windowState = socialReplyWindow(lastIncoming, historyReliable, Date.now());
  const blocked = windowState.mode === 'blocked';

  useEffect(() => {
    const controller = new AbortController();
    setMessages(null);
    setError(null);
    void api.socialMessages(conversation.id, account.id, null, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (!result.ok) return setError(result.message);
      setMessages(result.data.messages);
      setCursor(result.data.nextCursor);
      setHasMore(result.data.hasMore);
      setHistoryReliable(result.data.historyReliable);
    });
    return () => controller.abort();
  }, [api, account.id, conversation.id]);

  // Troca de conversa: rascunho e tentativa anteriores não valem para outra pessoa
  useEffect(() => {
    setText('');
    setFeedback(null);
    attempt.current = null;
    pinned.current = true;
  }, [conversation.id]);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = text.trim();
    if (!canReply || blocked || sending || body.length === 0) return;
    const requestId = attempt.current && attempt.current.text === body ? attempt.current.requestId : crypto.randomUUID();
    attempt.current = { text: body, requestId };
    setSending(true);
    setFeedback(null);
    const result = await api.socialSend({ accountId: account.id, conversationId: conversation.id, requestId, text: body });
    setSending(false);
    textareaRef.current?.focus();
    // Falha de rede ou resposta inválida: o texto e o pedido ficam para repetir com segurança
    if (!result.ok) return setFeedback({ tone: 'error', text: result.message });
    // Resposta definitiva do servidor (enviado, recusado ou incerto): o próximo envio é outra intenção
    attempt.current = null;
    setFeedback({ tone: result.data.status === 'sent' ? 'ok' : 'error', text: result.data.message });
    if (result.data.status === 'sent') {
      setText('');
      pinned.current = true;
      void refreshMessages();
    }
  }

  // Conversa aberta ou atualizada: a rolagem vai para a última mensagem (embaixo), como num chat
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || !messages) return;
    if (restoreHeight.current !== null) {
      // Mensagens antigas acrescentadas em cima: a posição de leitura não muda
      list.scrollTop += list.scrollHeight - restoreHeight.current;
      restoreHeight.current = null;
    } else if (pinned.current) {
      list.scrollTop = list.scrollHeight;
    }
  }, [messages]);

  // Lê a primeira página de novo e acrescenta o que chegou (sem apagar o histórico já carregado)
  async function refreshMessages(isActive: () => boolean = () => true) {
    const result = await api.socialMessages(conversation.id, account.id, null);
    if (!isActive() || !result.ok) return;
    setMessages((current) => mergeFreshMessages(current ?? [], result.data.messages));
    setHistoryReliable(result.data.historyReliable);
  }

  const loaded = messages !== null;
  useEffect(() => {
    if (!loaded) return;
    let active = true;
    const timer = window.setInterval(() => {
      if (!document.hidden) void refreshMessages(() => active);
    }, SOCIAL_CHAT_REFRESH_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, account.id, conversation.id]);

  async function loadOlder() {
    if (!cursor) return;
    setLoadingOlder(true);
    const result = await api.socialMessages(conversation.id, account.id, cursor);
    setLoadingOlder(false);
    if (!result.ok) return setError(result.message);
    restoreHeight.current = listRef.current?.scrollHeight ?? null;
    setMessages((current) => [...result.data.messages, ...(current ?? [])]);
    setCursor(result.data.nextCursor);
    setHasMore(result.data.hasMore);
  }

  return (
    <>
      <header className="chat__header">
        <button type="button" className="icon-button chat__back" aria-label="Voltar para as conversas" onClick={onBack}>
          <ArrowLeft aria-hidden="true" />
        </button>
        <span className="avatar" aria-hidden="true">{initials(name)}</span>
        <div className="chat__identity">
          <h2 className="chat__name">{name}</h2>
          <p className="chat__meta">
            <PlatformBadge platform={account.platform} small /> {platformLabel(account.platform)} · {account.name}
          </p>
        </div>
      </header>
      <p className="field__hint social-inbox__note">{READ_ONLY_NOTE}</p>
      {messages && !historyReliable && (
        <p className="notice social-inbox__warning" role="alert">A ordem do histórico não foi confirmada pela Zernio. Ele pode estar incompleto, e "ver anteriores" está desativado.</p>
      )}
      {error && <p className="auth-alert" role="alert">{error}</p>}
      {!messages && !error && <p className="integration__loading" role="status">Carregando a conversa…</p>}
      {messages && (
        <ol
          className="chat__messages"
          aria-label="Mensagens"
          ref={listRef}
          onScroll={() => {
            const list = listRef.current;
            if (list) pinned.current = list.scrollHeight - list.scrollTop - list.clientHeight < 120;
          }}
        >
          {hasMore && historyReliable && (
            <li className="chat__older">
              <button type="button" className="action-button" disabled={loadingOlder} onClick={() => void loadOlder()}>
                {loadingOlder ? 'Carregando…' : 'Ver mensagens anteriores'}
              </button>
            </li>
          )}
          {messages.length === 0 && <li className="inbox__empty">Esta conversa ainda não tem mensagens de texto para mostrar.</li>}
          {messages.map((item) => {
            const incoming = item.direction === 'incoming';
            return (
              <li key={item.id} className={`msg ${incoming ? 'msg--inbound' : 'msg--outbound'}`}>
                <span className="msg__author">{incoming ? name : 'Empresa'}</span>
                {item.text && <p className="msg__text">{item.text}</p>}
                {item.attachmentTypes.map((type, index) => (
                  <p key={index} className="msg__media">
                    [{ATTACHMENT_LABELS[type]}] <span>a visualização chega numa próxima etapa</span>
                  </p>
                ))}
                {!item.text && item.attachmentTypes.length === 0 && <p className="msg__media">Mensagem sem conteúdo de texto</p>}
                <span className="msg__foot">
                  {item.sentAt && <time dateTime={item.sentAt}>{dateTime(item.sentAt)}</time>}
                  {item.sentAt && <span className="sr-only"> ({messageTime(item.sentAt)})</span>}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {messages && (
        <form className="inbox-reply" aria-label="Resposta pelo Instagram" onSubmit={(event) => void send(event)}>
          {feedback && <p className={feedback.tone === 'ok' ? 'inbox-reply__feedback inbox-reply__feedback--ok' : 'inbox-reply__feedback inbox-reply__feedback--error'} role={feedback.tone === 'ok' ? 'status' : 'alert'}>{feedback.text}</p>}
          <p className={`inbox-reply__window inbox-reply__window--${windowState.mode}`} role="status">{windowState.label}</p>
          <label className="sr-only" htmlFor="social-reply">Resposta para {name}</label>
          <div className="inbox-reply__bar">
            <textarea
              id="social-reply"
              className="inbox-reply__input"
              rows={1}
              maxLength={SOCIAL_REPLY_TEXT_MAX}
              value={text}
              onChange={(event) => setText(event.target.value)}
              ref={textareaRef}
              disabled={!canReply || blocked}
              placeholder={canReply ? 'Escreva uma mensagem' : 'Só o dono, administradores e atendentes podem responder'}
            />
            <button type="submit" className="inbox-reply__send" aria-label="Enviar" title={sending ? 'Enviando…' : 'Enviar'} disabled={!canReply || blocked || sending || text.trim().length === 0}>
              {sending ? <LoaderCircle className="inbox-reply__spin" aria-hidden="true" /> : <Send aria-hidden="true" />}
            </button>
          </div>
          <span className="inbox-reply__count">{text.length}/{SOCIAL_REPLY_TEXT_MAX}</span>
        </form>
      )}
    </>
  );
}

/** Coluna 3: perfil do contato na conversa escolhida (só o que a Zernio informa) */
export function SocialDetails({ account, conversation }: { account: SocialAccountRef; conversation: SocialInboxConversation | null }) {
  if (!conversation) {
    return (
      <p className="inbox__empty">
        <Info aria-hidden="true" /> Os dados do contato aparecem aqui quando uma conversa é aberta.
      </p>
    );
  }
  const name = contactName(conversation);
  return (
    <>
      <div className="details__head">
        <h2>Contato</h2>
      </div>
      <div className="details__contact">
        <span className="avatar avatar--large" aria-hidden="true">{initials(name)}</span>
        <strong>{name}</strong>
        <span className="field__hint">{conversation.archived ? 'Conversa arquivada na rede' : 'Conversa ativa na rede'}</span>
      </div>
      <dl className="details__facts">
        <dt>Rede</dt>
        <dd>
          <PlatformBadge platform={account.platform} small /> {platformLabel(account.platform)}
        </dd>
        <dt>Conta</dt>
        <dd>{account.name}</dd>
        <dt>Última atividade</dt>
        <dd>{conversation.updatedAt ? dateTime(conversation.updatedAt) : 'Não informada pela rede'}</dd>
        <dt>Não lidas</dt>
        <dd>{conversation.unreadCount ?? 'Não informado pela rede'}</dd>
      </dl>
      <p className="field__hint">Somente leitura nesta etapa.</p>
    </>
  );
}

/** Conversa de rede com a conta de onde veio (lista unificada e detalhes) */
export interface SocialEntry {
  account: SocialAccountRef;
  conversation: SocialInboxConversation;
}

/** Nome exibido do contato (usado pela lista unificada) */
export const socialContactName = contactName;

/** Rede sem leitura de conversas nesta etapa: a conta aparece como conectada, sem mensagens e sem chamadas à rede */
export function SocialUnsupported({ account }: { account: SocialAccountRef }) {
  return (
    <div className="social-inbox__unsupported" role="status">
      <div className="social-inbox__head social-inbox__head--account">
        <span className="social-inbox__label">Conta conectada</span>
        <PlatformBadge platform={account.platform} small />
        <strong>{account.name}</strong>
      </div>
      <p className="inbox__empty">Leitura de conversas de {platformLabel(account.platform)} ainda não habilitada nesta etapa. A conta está conectada, mas as mensagens não aparecem aqui.</p>
    </div>
  );
}

/** Diagnóstico das datas (homologação Z2.4): aparece só para dono e administradores; mostra datas e campos, nunca o texto */
export function SocialDateDiagnosticPanel({ api, conversationId, accountId }: { api: InboxApi; conversationId: string; accountId: string }) {
  const [result, setResult] = useState<SocialDateDiagnostic | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    setError(null);
    const response = await api.socialDateDiagnostic(conversationId, accountId);
    setBusy(false);
    if (!response.ok) return setError(response.message);
    setResult(response.data);
  }
  // Escolhida na lista, a leitura começa sozinha (um clique a menos, e nenhuma outra leitura)
  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, accountId]);
  const when = (value: string | null) => (value ? new Date(value).toLocaleString('pt-BR') : 'ausente');
  return (
    <div className="social-diagnostic" role="group" aria-label="Diagnóstico das datas">
      <button type="button" className="action-button" disabled={busy} onClick={() => void run()}>
        {busy ? 'Lendo as datas…' : 'Ler de novo'}
      </button>
      {error && <p className="auth-alert" role="alert">{error}</p>}
      {result && (
        <div className="social-diagnostic__result" role="status">
          <p>Mensagens lidas: {result.readCount}{result.hasMore ? ' (há mais, não lidas)' : ''} · ordem aplicada pela Zernio: {result.sortOrderApplied ?? 'não informada'}</p>
          <p>Ordem da Zernio bate com sentAt: {result.orderMatchesSentAt ? 'sim' : 'não'} · com createdAt: {result.orderMatchesCreatedAt ? 'sim' : 'não'}</p>
          <p>Última do contato: sentAt {when(result.lastIncoming?.sentAt ?? null)} · createdAt {when(result.lastIncoming?.createdAt ?? null)}</p>
          <p>Mais recente lida: sentAt {when(result.newest?.sentAt ?? null)} · createdAt {when(result.newest?.createdAt ?? null)}</p>
          <ol className="social-diagnostic__list">
            {result.messages.map((item, index) => (
              <li key={index}>
                {item.direction === 'incoming' ? 'Contato' : 'Empresa'} · texto: {item.hasText ? 'sim' : 'não'} · anexos: {item.attachmentTypes.length ? item.attachmentTypes.join(', ') : 'nenhum'} · sentAt {when(item.sentAt)} · createdAt {when(item.createdAt)} · diferença: {item.sentMinusCreatedSeconds === null ? 'n/d' : `${Math.round(item.sentMinusCreatedSeconds)} s`}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
