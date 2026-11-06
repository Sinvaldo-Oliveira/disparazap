import { CircleCheck, ExternalLink, KeyRound, Link2, MessageCircle, Plus, RefreshCw, Share2, ShieldCheck, Trash2, TriangleAlert, Unplug, Webhook } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import {
  ZERNIO_BILLING_URL,
  ZERNIO_FREE_ACCOUNTS,
  ZERNIO_PLATFORMS,
  ZERNIO_PLATFORM_LABELS,
  ZERNIO_PLATFORM_NOTES,
  zernioKeySchema,
  type ZernioAccount,
  type ZernioAccountState,
  type ZernioInboxAccessOutcome,
  type ZernioInboxAccessResult,
  type ZernioOutsideAccount,
  type ZernioPlatform,
  type ZernioStatus,
} from '@disparazap/contracts';
import type { NavigationItem } from '../app/navigation';
import { useSession } from '../auth/AuthProvider';
import { Card } from '../components/Card';
import { PageHeader } from '../components/PageHeader';
import { PasswordField } from '../components/PasswordField';
import { PlatformBadge, isKnownPlatform, platformLabel } from '../components/PlatformBadge';
import { InDevelopmentBadge, StatusBadge, type BadgeTone } from '../components/StatusBadge';
import type { InboxApi } from '../inbox/inbox-api';
import type { ZernioApi } from '../integrations/zernio-api';
import type { WhatsAppApi } from '../whatsapp/whatsapp-api';
import { WhatsAppIntegration } from './WhatsAppPage';

const DESCRIPTION = 'Conecte o DisparaZap a outras plataformas. Cada empresa usa as próprias contas e chaves.';

/** Resultado da volta da autorização, entregue pela página de retorno */
export interface ZernioResultState {
  zernioResult?: { ok: boolean; message: string };
}

/** billing: a Zernio pediu pagamento (HTTP 402) e a mensagem ganha o link da cobrança da Zernio */
type Notice = { tone: 'success' | 'error'; text: string; billing?: boolean } | null;

const defaultRedirect = (url: string) => window.location.assign(url);

/** Confirmação antes de conectar uma rede que já está conectada: a mesma conta duas vezes ocupa duas vagas na Zernio */
function ConnectWarning({
  warning,
  here,
  elsewhere,
  onConfirm,
  onCancel,
}: {
  warning: { platform: ZernioPlatform; reason: 'another' | 'elsewhere' };
  here: readonly ZernioAccount[];
  elsewhere: readonly ZernioOutsideAccount[];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const label = ZERNIO_PLATFORM_LABELS[warning.platform];
  const outsideNames = elsewhere.map((account) => `${account.username ? `@${account.username}` : 'conta'}${account.profileName ? ` (perfil "${account.profileName}")` : ''}`).join(', ');
  return (
    <div className="instance__confirm instance__confirm--warn" role="alertdialog" aria-label="Confirmar nova conexão">
      {warning.reason === 'another' ? (
        <p>
          Você já tem {label} conectado: <strong>{here.map(accountName).join(', ')}</strong>. Para renovar a autorização dessa mesma conta, use{' '}
          <strong>Reconectar</strong> na lista de redes conectadas. Conectar de novo a mesma conta ocupa mais uma vaga na Zernio. Continue só se for
          outra conta do {label}.
        </p>
      ) : (
        <p>
          {label} já está conectado na sua conta Zernio em outro perfil: <strong>{outsideNames}</strong>. Conectar aqui conta como mais uma rede na Zernio
          (as {ZERNIO_FREE_ACCOUNTS} grátis valem para a conta inteira). Se for a mesma conta, desconecte a do outro perfil no painel da Zernio antes.
        </p>
      )}
      <div className="integration__actions">
        <button type="button" className="action-button action-button--primary" onClick={onConfirm}>
          {warning.reason === 'another' ? 'Conectar outra conta' : 'Conectar mesmo assim'}
        </button>
        <button type="button" className="action-button" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

/** Quantas redes a Zernio conta na conta inteira (é esse total que vale para as redes grátis) e quais estão fora do perfil */
function ZernioUsage({ teamCount, outside }: { teamCount: number; outside: readonly ZernioOutsideAccount[] }) {
  return (
    <div className={`zernio-usage${outside.length ? ' zernio-usage--warn' : ''}`} role="note" aria-label="Uso da conta Zernio">
      <p>
        Na sua conta Zernio inteira (todos os perfis): <strong>{teamCount === 1 ? '1 rede conectada' : `${teamCount} redes conectadas`}</strong>. As{' '}
        {ZERNIO_FREE_ACCOUNTS} primeiras são grátis; o X exige cartão desde a primeira.
      </p>
      {outside.length > 0 && (
        <>
          <p>Também contam estas redes, conectadas fora do perfil do DisparaZap (no painel da Zernio ou em outro perfil):</p>
          <ul>
            {outside.map((account, index) => (
              <li key={`${account.platform}-${account.username ?? ''}-${index}`}>
                {platformLabel(account.platform)} {account.username ? `@${account.username}` : ''}
                {account.profileName ? ` — perfil "${account.profileName}"` : ''}
              </li>
            ))}
          </ul>
          <p>Se for a mesma rede conectada duas vezes, desconecte a cópia no painel da Zernio para liberar a vaga.</p>
        </>
      )}
    </div>
  );
}


const ACCOUNT_STATES: Readonly<Record<ZernioAccountState, { label: string; tone: BadgeTone }>> = {
  ok: { label: 'Conectada', tone: 'success' },
  needs_reconnect: { label: 'Precisa reconectar', tone: 'danger' },
  warning: { label: 'Atenção', tone: 'development' },
};

const formatDateTime = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const accountName = (account: ZernioAccount) => account.displayName ?? (account.username ? `@${account.username}` : 'Conta sem nome');

const INBOX_OUTCOME_TONE: Readonly<Record<ZernioInboxAccessOutcome, BadgeTone>> = {
  confirmed: 'success',
  unavailable: 'danger',
  auth_failed: 'danger',
  temporary: 'development',
  inconclusive: 'neutral',
};
const INBOX_OUTCOME_LABEL: Readonly<Record<ZernioInboxAccessOutcome, string>> = {
  confirmed: 'Acesso confirmado',
  unavailable: 'Recurso indisponível',
  auth_failed: 'Falha de autenticação',
  temporary: 'Falha temporária',
  inconclusive: 'Diagnóstico inconclusivo',
};

/**
 * Teste de acesso à Inbox da Zernio (Z1): consulta de leitura, só para administradores, com confirmação. Não roda sozinho.
 * O resultado mostra a mensagem fixa da API e o código da Zernio, sem conteúdo de mensagem.
 */
function ZernioInboxAccess({ api, enabled, canManage }: { api: ZernioApi; enabled: boolean; canManage: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ZernioInboxAccessResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!enabled) return null;

  async function run() {
    setBusy(true);
    setError(null);
    const response = await api.testInboxAccess();
    setBusy(false);
    setConfirming(false);
    if (!response.ok) return setError(response.message);
    setResult(response.data);
  }

  return (
    <div className="zernio-inbox" role="group" aria-label="Teste de acesso à Inbox">
      <h3 className="card__title">Acesso à Inbox</h3>
      <p className="card__text">
        Consulta de leitura à Zernio, com 1 conversa no máximo, para saber se o recurso Inbox está liberado nesta conta. Nenhuma mensagem é enviada
        nem alterada.
      </p>
      {!canManage ? (
        <p className="field__hint">Só o dono e os administradores fazem o teste.</p>
      ) : confirming ? (
        <div className="instance__confirm" role="alertdialog" aria-label="Confirmar consulta à Zernio">
          <p>Será feita uma consulta real, só de leitura, à Zernio, com o perfil desta empresa. Continuar?</p>
          <div className="integration__actions">
            <button type="button" className="action-button action-button--primary" disabled={busy} onClick={() => void run()}>
              {busy ? 'Consultando…' : 'Fazer a consulta'}
            </button>
            <button type="button" className="action-button" disabled={busy} onClick={() => setConfirming(false)}>
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <div className="integration__actions">
          <button type="button" className="action-button" onClick={() => { setError(null); setConfirming(true); }}>
            Testar acesso à Inbox
          </button>
        </div>
      )}
      {error && <p className="auth-alert" role="alert">{error}</p>}
      {result && (
        <div className="zernio-inbox__result" role="status">
          <StatusBadge tone={INBOX_OUTCOME_TONE[result.outcome]}>{INBOX_OUTCOME_LABEL[result.outcome]}</StatusBadge>
          <p>{result.message}</p>
          {result.code && <p className="field__hint">Código da Zernio: <code>{result.code}</code></p>}
          {result.hasConversations !== null && (
            <p className="field__hint">{result.hasConversations ? 'Há conversas nesta conta.' : 'Nenhuma conversa encontrada nesta conta.'}</p>
          )}
          <p className="field__hint">Verificado às {new Date(result.checkedAt).toLocaleTimeString('pt-BR')}.</p>
        </div>
      )}
    </div>
  );
}

export interface IntegrationsPageProps {
  item: NavigationItem;
  api: ZernioApi;
  /** WhatsApp (Evolution Go): instâncias da empresa, na seção logo abaixo dos cards */
  whatsappApi: WhatsAppApi;
  /** Inbox: botão "Receber mensagens na Inbox" em cada instância (sem ela, o botão não aparece) */
  inboxApi?: InboxApi;
  /** Intervalo de acompanhamento da conexão do WhatsApp (os testes usam um valor curto) */
  whatsappPollMs?: number;
  /** Leva o navegador ao link de autorização (os testes trocam) */
  redirect?: (url: string) => void;
}

/** Chegada com #whatsapp ou #zernio (ex.: o endereço antigo /whatsapp): leva a tela até a seção */
function useScrollToHash() {
  const { hash } = useLocation();
  useEffect(() => {
    if (!hash) return;
    const timer = setTimeout(() => document.getElementById(hash.slice(1))?.scrollIntoView?.({ block: 'start' }), 0);
    return () => clearTimeout(timer);
  }, [hash]);
}

export function IntegrationsPage({ item, api, whatsappApi, inboxApi, whatsappPollMs = 3000, redirect = defaultRedirect }: IntegrationsPageProps) {
  const session = useSession();
  useScrollToHash();
  if (!session.organization) {
    // Sem empresa (Super-Admin da plataforma): acompanha o WhatsApp de todas as empresas; a Zernio é de cada empresa
    return (
      <>
        <PageHeader title={item.label} icon={item.icon} description={DESCRIPTION} />
        <WhatsAppIntegration api={whatsappApi} pollMs={whatsappPollMs} />
        <Card title="Zernio: sem empresa nesta conta">
          <p className="card__text">As redes sociais (Zernio) pertencem às empresas: cada uma liga a própria conta. Sua conta não está ligada a uma empresa.</p>
        </Card>
      </>
    );
  }
  return <Integrations item={item} api={api} whatsappApi={whatsappApi} {...(inboxApi ? { inboxApi } : {})} whatsappPollMs={whatsappPollMs} redirect={redirect} />;
}

function Integrations({ item, api, whatsappApi, inboxApi, whatsappPollMs, redirect }: Required<Omit<IntegrationsPageProps, 'inboxApi'>> & Pick<IntegrationsPageProps, 'inboxApi'>) {
  const location = useLocation();
  const navigate = useNavigate();
  const [result] = useState((location.state as ZernioResultState | null)?.zernioResult ?? null);

  // A mensagem da volta fica nesta tela; o estado da navegação é limpo para ela não reaparecer ao recarregar
  useEffect(() => {
    if (result) navigate(location.pathname, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só na chegada
  }, []);
  const [status, setStatus] = useState<ZernioStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<ZernioAccount[] | null>(null);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  // Total da conta Zernio inteira (todos os perfis), como a Zernio conta para a cobrança, e as redes fora do perfil
  const [teamCount, setTeamCount] = useState<number | null>(null);
  const [outside, setOutside] = useState<ZernioOutsideAccount[]>([]);
  const [apiKey, setApiKey] = useState('');
  const [editingKey, setEditingKey] = useState(false);
  const [keyNotice, setKeyNotice] = useState<Notice>(null);
  const [networkNotice, setNetworkNotice] = useState<Notice>(null);
  const [confirm, setConfirm] = useState<'remove' | ZernioAccount | null>(null);
  // Antes de conectar uma rede que já está conectada (aqui ou em outro perfil da Zernio): evita a mesma conta duas vezes
  const [connectWarning, setConnectWarning] = useState<{ platform: ZernioPlatform; reason: 'another' | 'elsewhere' } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const loadAccounts = useCallback(
    async (signal?: AbortSignal) => {
      const response = await api.accounts(signal);
      if (signal?.aborted) return;
      if (!response.ok) {
        setAccounts(null);
        setTeamCount(null);
        setAccountsError(response.message);
      } else {
        setAccountsError(null);
        setAccounts(response.data.accounts);
        setTeamCount(response.data.teamAccountCount);
        setOutside(response.data.outsideAccounts);
      }
      // Ler as redes confere a chave na Zernio e pode mudar a situação guardada (recusada ↔ ativa): relê a situação
      const fresh = await api.status(signal);
      if (!signal?.aborted && fresh.ok) setStatus(fresh.data);
    },
    [api],
  );

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const response = await api.status(signal);
      if (signal?.aborted) return;
      if (!response.ok) return setLoadError(response.message);
      setLoadError(null);
      setStatus(response.data);
      if (response.data.configured) await loadAccounts(signal);
      else setAccounts(null);
    },
    [api, loadAccounts],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  // Voltar da Zernio pelo botão Voltar do navegador pode restaurar a página do cache com os botões travados em "Abrindo…"
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) setBusy(null);
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  async function saveKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setKeyNotice(null);
    const checked = zernioKeySchema.safeParse(apiKey);
    if (!checked.success) return setKeyNotice({ tone: 'error', text: checked.error.issues[0]?.message ?? 'Chave inválida.' });
    setBusy('key');
    const response = await api.saveKey(checked.data);
    setBusy(null);
    if (!response.ok) return setKeyNotice({ tone: 'error', text: response.message, billing: response.status === 402 });
    setApiKey('');
    setEditingKey(false);
    setStatus(response.data);
    setKeyNotice({ tone: 'success', text: 'Conta Zernio conectada. A chave fica guardada cifrada e não é exibida de novo.' });
    await loadAccounts();
  }

  async function removeIntegration() {
    setConfirm(null);
    setBusy('remove');
    const response = await api.removeKey();
    setBusy(null);
    if (!response.ok) return setKeyNotice({ tone: 'error', text: response.message });
    setKeyNotice({ tone: 'success', text: 'Integração removida. A chave foi apagada do DisparaZap; a sua conta Zernio não mudou.' });
    setNetworkNotice(null);
    await load();
  }

  async function connect(platform: ZernioPlatform, reconnectAccountId: string | null) {
    setNetworkNotice(null);
    setBusy(`connect:${platform}:${reconnectAccountId ?? ''}`);
    const response = await api.connect(platform, reconnectAccountId);
    if (!response.ok) {
      setBusy(null);
      return setNetworkNotice({ tone: 'error', text: response.message, billing: response.status === 402 });
    }
    // O navegador sai do painel para autorizar na Zernio e na rede; a volta é pela página de retorno
    redirect(response.data.authUrl);
  }

  async function disconnect(account: ZernioAccount) {
    setConfirm(null);
    setNetworkNotice(null);
    setBusy(`disconnect:${account.id}`);
    const response = await api.disconnect(account.id);
    setBusy(null);
    if (!response.ok) return setNetworkNotice({ tone: 'error', text: response.message });
    setNetworkNotice({ tone: 'success', text: `${platformLabel(account.platform)} ${accountName(account)} desconectado.` });
    await loadAccounts();
  }

  const showNotice = (notice: Notice) =>
    notice && (
      <p className={notice.tone === 'success' ? 'integration__success' : 'auth-alert'} role={notice.tone === 'success' ? 'status' : 'alert'}>
        {notice.text}
        {notice.billing && (
          <>
            {' '}
            <a className="text-link" href={ZERNIO_BILLING_URL} target="_blank" rel="noopener noreferrer">
              Abrir a cobrança na Zernio
            </a>
          </>
        )}
      </p>
    );

  const zernioBadge = !status ? (
    <StatusBadge tone="neutral">Carregando…</StatusBadge>
  ) : !status.available ? (
    <StatusBadge tone="neutral">Indisponível</StatusBadge>
  ) : !status.configured ? (
    <StatusBadge tone="neutral">Não configurada</StatusBadge>
  ) : status.status === 'invalid' ? (
    <StatusBadge tone="danger">Chave recusada</StatusBadge>
  ) : (
    <StatusBadge tone="success">Conectada</StatusBadge>
  );

  const canManage = status?.canManage ?? false;
  const showKeyForm = Boolean(status?.available && canManage && (!status.configured || editingKey));

  return (
    <>
      <PageHeader title={item.label} icon={item.icon} description={DESCRIPTION} />

      {result && showNotice({ tone: result.ok ? 'success' : 'error', text: result.message })}

      <section aria-label="Catálogo de integrações">
        <ul className="catalog">
          <li className="catalog__card">
            <MessageCircle className="catalog__icon" aria-hidden="true" />
            <div className="catalog__body">
              <div className="catalog__head">
                <strong>WhatsApp</strong>
                <StatusBadge tone="success">Disponível</StatusBadge>
              </div>
              <p>Números de WhatsApp da empresa, conectados pela Evolution Go (QR Code ou código de pareamento).</p>
              <a className="text-link" href="#whatsapp">
                Ver instâncias
              </a>
            </div>
          </li>
          <li className="catalog__card">
            <Share2 className="catalog__icon" aria-hidden="true" />
            <div className="catalog__body">
              <div className="catalog__head">
                <strong>Zernio</strong>
                {zernioBadge}
              </div>
              <p>Redes sociais da empresa: Instagram, Facebook, TikTok, LinkedIn, YouTube e outras.</p>
              {status?.configured && accounts && <p className="catalog__meta">{accounts.length === 1 ? '1 rede conectada' : `${accounts.length} redes conectadas`}</p>}
              <a className="text-link" href="#zernio">
                Ver redes sociais
              </a>
            </div>
          </li>
          <li className="catalog__card">
            <Webhook className="catalog__icon" aria-hidden="true" />
            <div className="catalog__body">
              <div className="catalog__head">
                <strong>API e webhooks (MyLinksss)</strong>
                <InDevelopmentBadge />
              </div>
              <p>API REST versionada e webhooks assinados para o MyLinksss e outras plataformas.</p>
            </div>
          </li>
        </ul>
      </section>

      <WhatsAppIntegration api={whatsappApi} pollMs={whatsappPollMs} {...(inboxApi ? { inboxApi } : {})} />

      <section id="zernio" className="card integration" aria-label="Zernio">
        <h2 className="card__title">Zernio · redes sociais</h2>
        <p className="card__text">
          A Zernio liga o DisparaZap às redes sociais da sua empresa. Você usa a <strong>sua própria conta Zernio</strong>: a cobrança dela é
          por rede conectada (as 2 primeiras são grátis) e fica na sua conta.
        </p>

        {loadError ? (
          <p className="auth-alert" role="alert">{loadError}</p>
        ) : !status ? (
          <p className="integration__loading" role="status">Carregando a integração…</p>
        ) : !status.available ? (
          <div className="notice" role="alert">
            <TriangleAlert className="notice__icon" aria-hidden="true" />
            <p>
              <strong>Cofre de credenciais não configurado no servidor.</strong> Sem a <code>SECRETS_MASTER_KEY</code>, a chave da Zernio não pode
              ser guardada. Fale com o administrador da plataforma.
            </p>
          </div>
        ) : (
          <>
            {status.configured && (
              <>
                <dl className="zernio-summary">
                  <div>
                    <dt>Conta Zernio</dt>
                    <dd>{status.accountName ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>Chave</dt>
                    <dd className="zernio-summary__key">••••{status.keyLast4 ?? ''}</dd>
                  </div>
                  <div>
                    <dt>Perfil na Zernio</dt>
                    <dd>{status.profileName ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>Última verificação</dt>
                    <dd>{status.lastCheckAt ? formatDateTime(status.lastCheckAt) : '—'}</dd>
                  </div>
                </dl>
                {status.status === 'invalid' && (
                  <div className="notice" role="alert">
                    <TriangleAlert className="notice__icon" aria-hidden="true" />
                    <p>
                      <strong>A Zernio recusou a chave guardada.</strong> Ela pode ter sido revogada ou apagada no painel da Zernio.
                      {canManage ? ' Cadastre uma chave nova em "Trocar chave".' : ' Peça ao dono ou a um administrador para cadastrar uma chave nova.'}
                    </p>
                  </div>
                )}
                {canManage && !editingKey && (
                  <div className="integration__actions">
                    <button
                      type="button"
                      className="action-button"
                      disabled={busy !== null}
                      onClick={() => {
                        setEditingKey(true);
                        setKeyNotice(null);
                      }}
                    >
                      <KeyRound aria-hidden="true" /> Trocar chave
                    </button>
                    <button type="button" className="action-button action-button--danger" disabled={busy !== null} onClick={() => setConfirm('remove')}>
                      <Trash2 aria-hidden="true" /> Remover integração
                    </button>
                  </div>
                )}
              </>
            )}

            {!status.configured && !canManage && (
              <p className="card__text">A integração com a Zernio ainda não foi configurada. Peça ao dono ou a um administrador da empresa.</p>
            )}

            {showKeyForm && (
              <form className="integration__form" onSubmit={(event) => void saveKey(event)} noValidate aria-label="Cadastro da chave da Zernio">
                <ol className="zernio-steps">
                  <li>
                    Crie a sua conta em{' '}
                    <a className="text-link" href="https://zernio.com/" target="_blank" rel="noopener noreferrer">
                      zernio.com
                    </a>
                    .
                  </li>
                  <li>
                    No painel da Zernio, abra <strong>API Keys</strong> e crie uma chave.
                  </li>
                  <li>Recomendado: desligue o que o DisparaZap não usa (cobrança, anúncios e dinheiro).</li>
                  <li>Copie a chave: a Zernio mostra uma vez só. Cole abaixo.</li>
                </ol>
                <PasswordField
                  label="Chave de API da Zernio"
                  value={apiKey}
                  onChange={(value) => {
                    setApiKey(value);
                    setKeyNotice(null);
                  }}
                  autoComplete="new-password"
                  hint="Começa com sk_. Ela é testada na Zernio, guardada cifrada e nunca mais exibida."
                />
                <div className="integration__actions">
                  <button type="submit" className="action-button action-button--primary" disabled={busy !== null}>
                    <ShieldCheck aria-hidden="true" /> {busy === 'key' ? 'Testando…' : 'Testar e salvar'}
                  </button>
                  {status.configured && (
                    <button
                      type="button"
                      className="action-button"
                      onClick={() => {
                        setEditingKey(false);
                        setApiKey('');
                        setKeyNotice(null);
                      }}
                    >
                      Cancelar
                    </button>
                  )}
                </div>
              </form>
            )}

            {confirm === 'remove' && (
              <div className="instance__confirm" role="alertdialog" aria-label="Confirmar remoção da integração">
                <p>
                  Remover a integração com a Zernio? O DisparaZap apaga a chave guardada. Nada muda na sua conta Zernio: as redes continuam
                  conectadas lá e voltam a aparecer quando você cadastrar uma chave de novo.
                </p>
                <div className="integration__actions">
                  <button type="button" className="action-button action-button--danger" onClick={() => void removeIntegration()}>
                    Remover integração
                  </button>
                  <button type="button" className="action-button" onClick={() => setConfirm(null)}>
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            <ZernioInboxAccess api={api} enabled={Boolean(status?.configured)} canManage={canManage} />

            {showNotice(keyNotice)}
          </>
        )}
      </section>

      {status?.available && status.configured && (
        <section className="card" aria-label="Redes sociais">
          <h2 className="card__title">Redes sociais</h2>

          {canManage && (
            <>
              <p className="card__text">Escolha a rede e autorize na Zernio. Ao terminar, você volta para esta página.</p>
              <ul className="platform-grid">
                {ZERNIO_PLATFORMS.map((platform) => {
                  const note = ZERNIO_PLATFORM_NOTES[platform];
                  const label = ZERNIO_PLATFORM_LABELS[platform];
                  // Contas desta rede no perfil do DisparaZap e em outros perfis da conta Zernio
                  const here = (accounts ?? []).filter((account) => account.platform === platform);
                  const elsewhere = outside.filter((account) => account.platform === platform);
                  const connected = here.length > 0;
                  const attention = here.some((account) => account.state !== 'ok');
                  // Conta que precisa reconectar: o botão do card renova a autorização dessa mesma conta
                  const toReconnect = here.find((account) => account.state === 'needs_reconnect') ?? null;
                  const askFirst = connected ? 'another' : elsewhere.length > 0 ? 'elsewhere' : null;
                  const tileClass = `platform-tile${connected ? (attention ? ' platform-tile--attention' : ' platform-tile--connected') : ''}`;
                  return (
                    <li key={platform} className={tileClass}>
                      <PlatformBadge platform={platform} />
                      <div className="platform-tile__body">
                        <div className="platform-tile__head">
                          <strong>{label}</strong>
                          {connected && (
                            <span className="platform-tile__tag">
                              {attention ? <TriangleAlert aria-hidden="true" /> : <CircleCheck aria-hidden="true" />}
                              {attention ? 'Precisa reconectar' : 'Conectado'}
                            </span>
                          )}
                        </div>
                        {connected ? <small className="platform-tile__accounts">{here.map(accountName).join(' · ')}</small> : note && <small>{note}</small>}
                        {!connected && elsewhere.length > 0 && (
                          <small className="platform-tile__elsewhere">
                            Já conectado na sua conta Zernio em outro perfil
                            {elsewhere[0]?.profileName ? ` ("${elsewhere[0].profileName}")` : ''}: conectar aqui conta como mais uma rede.
                          </small>
                        )}
                      </div>
                      {toReconnect ? (
                        <button
                          type="button"
                          className="icon-button"
                          aria-label={`Reconectar ${label}`}
                          disabled={busy !== null || status.status === 'invalid'}
                          onClick={() => void connect(platform, toReconnect.id)}
                        >
                          <RefreshCw aria-hidden="true" /> {busy === `connect:${platform}:${toReconnect.id}` ? 'Abrindo…' : 'Reconectar'}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="icon-button"
                          aria-label={connected ? `Conectar outra conta ${label}` : `Conectar ${label}`}
                          disabled={busy !== null || status.status === 'invalid'}
                          onClick={() => (askFirst ? setConnectWarning({ platform, reason: askFirst }) : void connect(platform, null))}
                        >
                          {connected ? <Plus aria-hidden="true" /> : <Link2 aria-hidden="true" />}{' '}
                          {busy === `connect:${platform}:` ? 'Abrindo…' : connected ? 'Outra conta' : 'Conectar'}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
              {connectWarning && (
                <ConnectWarning
                  warning={connectWarning}
                  here={(accounts ?? []).filter((account) => account.platform === connectWarning.platform)}
                  elsewhere={outside.filter((account) => account.platform === connectWarning.platform)}
                  onConfirm={() => {
                    const { platform } = connectWarning;
                    setConnectWarning(null);
                    void connect(platform, null);
                  }}
                  onCancel={() => setConnectWarning(null)}
                />
              )}
              <p className="field__hint">
                A tela de autorização da rede mostra o nome "Zernio". Na volta, a Zernio pode pedir um clique para continuar até o DisparaZap.
              </p>
            </>
          )}

          {showNotice(networkNotice)}

          <h3 className="zernio-accounts__title">Redes conectadas</h3>
          {teamCount !== null && <ZernioUsage teamCount={teamCount} outside={outside} />}
          {accountsError ? (
            <p className="auth-alert" role="alert">{accountsError}</p>
          ) : !accounts ? (
            <p className="integration__loading" role="status">Carregando as redes…</p>
          ) : accounts.length === 0 ? (
            <p className="field__hint">Nenhuma rede conectada ainda.{canManage ? ' Use os botões acima para conectar.' : ''}</p>
          ) : (
            <div className="table-wrap">
              <table className="table zernio-accounts">
                <thead>
                  <tr>
                    <th>Rede</th>
                    <th>Conta</th>
                    <th>Situação</th>
                    {canManage && <th><span className="sr-only">Ações</span></th>}
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((account) => {
                    const state = ACCOUNT_STATES[account.state];
                    const label = platformLabel(account.platform);
                    const name = accountName(account);
                    return (
                      <tr key={account.id}>
                        <td>
                          <span className="zernio-accounts__network">
                            <PlatformBadge platform={account.platform} /> {label}
                          </span>
                        </td>
                        <td>
                          <span className="zernio-accounts__name">{name}</span>
                          {account.displayName && account.username && <span className="zernio-accounts__user">@{account.username}</span>}
                          {account.profileUrl?.startsWith('https://') && (
                            <a className="text-link zernio-accounts__link" href={account.profileUrl} target="_blank" rel="noopener noreferrer">
                              Abrir perfil <ExternalLink aria-hidden="true" />
                            </a>
                          )}
                        </td>
                        <td>
                          <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
                        </td>
                        {canManage && (
                          <td>
                            <div className="row-actions">
                              {isKnownPlatform(account.platform) && (
                                <button
                                  type="button"
                                  className="icon-button"
                                  aria-label={`Reconectar ${label} ${name}`}
                                  disabled={busy !== null || status.status === 'invalid'}
                                  onClick={() => isKnownPlatform(account.platform) && void connect(account.platform, account.id)}
                                >
                                  <RefreshCw aria-hidden="true" /> Reconectar
                                </button>
                              )}
                              <button
                                type="button"
                                className="icon-button icon-button--danger"
                                aria-label={`Desconectar ${label} ${name}`}
                                disabled={busy !== null}
                                onClick={() => setConfirm(account)}
                              >
                                <Unplug aria-hidden="true" /> Desconectar
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {confirm && confirm !== 'remove' && (
            <div className="instance__confirm" role="alertdialog" aria-label="Confirmar desconexão da rede">
              <p>
                Desconectar {platformLabel(confirm.platform)} {accountName(confirm)}? A rede deixa de estar ligada à sua conta Zernio. Para usar de
                novo, é só conectar outra vez.
              </p>
              <div className="integration__actions">
                <button type="button" className="action-button action-button--danger" onClick={() => void disconnect(confirm)}>
                  Desconectar
                </button>
                <button type="button" className="action-button" onClick={() => setConfirm(null)}>
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {!canManage && <p className="field__hint">Você pode ver as redes conectadas. Só o dono e os administradores conectam e desconectam.</p>}
        </section>
      )}
    </>
  );
}
