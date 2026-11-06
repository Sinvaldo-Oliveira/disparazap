import { ArrowLeft, AtSign, CircleHelp, Copy, Info, Link2, Megaphone, MessageCircle, Plus, QrCode, Radio, Reply, Users, type LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, Route, Routes, useNavigate, useParams } from 'react-router';
import { AutomationBuilder } from './AutomationBuilder';
import { FlowBuilder } from './FlowBuilder';
import { QuestionFlowBuilder } from './QuestionFlowBuilder';
import { ACTIVITY_REFRESH_MS, type AutomationActivity, type AutomationDetail, type AutomationSummary, type AutomationsOverview, type FlowsList, type FlowSummary } from '@disparazap/contracts';
import type { NavigationItem } from '../../app/navigation';
import type { AutomationsApi } from '../../automations/automations-api';
import { automationSentence, CAPABILITY_TEXT, keywordsText, matchModeText, repeatText, thenText, whenText } from '../../automations/automation-text';
import { PageHeader } from '../../components/PageHeader';
import { PlatformBadge, platformLabel } from '../../components/PlatformBadge';
import { InDevelopmentBadge, StatusBadge } from '../../components/StatusBadge';

/**
 * Página Automações, seção "Redes sociais" (PLANO_MODULO_AUTOMACOES). Etapa A1: só consulta. As automações ficam na
 * Zernio; a API mostra só as das contas da empresa. Criar, editar, ativar e pausar chegam nas etapas A2 a A6.
 */

const DESCRIPTION = 'Respostas automáticas nas redes sociais, pela Zernio: quem comenta a palavra-chave recebe uma DM, quem menciona a conta num story recebe um agradecimento e mais.';

const TRIGGER_ICONS: Readonly<Record<string, LucideIcon>> = { comment: MessageCircle, live_comment: Radio, story_reply: Reply, story_mention: AtSign };

/** Modelos do plano: os que têm "template" já existem (A2 a A5); os demais chegam nas etapas A6 em diante */
const TEMPLATES: readonly { title: string; text: string; networks: string; icon: LucideIcon; template?: 'dm' | 'resposta' | 'seguidores' | 'story' | 'fluxo' | 'pergunta' }[] = [
  { title: 'Comentário → DM', text: 'Quem comentar a palavra-chave recebe uma DM, com até 3 botões de link.', networks: 'Instagram e Facebook', icon: MessageCircle, template: 'dm' },
  { title: 'Só seguidores', text: 'A recompensa só chega para quem segue a conta; quem ainda não segue recebe um botão para confirmar.', networks: 'Instagram', icon: Users, template: 'seguidores' },
  { title: 'Menção em story → DM', text: 'Agradece automaticamente quem marcar a conta num story.', networks: 'Instagram', icon: AtSign, template: 'story' },
  { title: 'Link ou QR → conversa', text: 'Um link abre a conversa com uma mensagem pronta e marca quem entrou. QR code: em breve.', networks: 'Instagram', icon: Link2, template: 'fluxo' },
  { title: 'Comentário → perguntar antes', text: 'Quem comenta recebe uma pergunta em texto; depois de responder, recebe o botão com o link.', networks: 'Instagram', icon: CircleHelp, template: 'pergunta' },
  { title: 'Comentário → resposta pública', text: 'Responde em público a quem comentar a palavra-chave (essas redes não permitem DM automática).', networks: 'TikTok, Threads, LinkedIn e YouTube', icon: Megaphone, template: 'resposta' },
];

const numberText = (value: number) => value.toLocaleString('pt-BR');

function StateBadge({ active }: { active: boolean }) {
  return <StatusBadge tone={active ? 'success' : 'neutral'}>{active ? 'Ativa' : 'Pausada'}</StatusBadge>;
}

function StageNotice({ writeEnabled }: { writeEnabled: boolean }) {
  if (writeEnabled) return null;
  return (
    <div className="notice automations__notice" role="status">
      <Info className="notice__icon" aria-hidden="true" />
      <p>Criar, alterar, ativar e excluir automações está desligado nesta plataforma até a homologação com uma conta de teste. Você pode consultar as automações e montar uma nova para ver a prévia.</p>
    </div>
  );
}

function AutomationsList({ api }: { api: AutomationsApi }) {
  const [overview, setOverview] = useState<AutomationsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void api.overview(controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (!result.ok) return setError(result.message);
      setOverview(result.data);
    });
    return () => controller.abort();
  }, [api]);

  return (
    <section className="card automations" aria-labelledby="automacoes-redes">
      <h2 id="automacoes-redes" className="card__title">
        Redes sociais
      </h2>
      {error && (
        <p className="auth-alert" role="alert">
          {error}
        </p>
      )}
      {!overview && !error && (
        <p className="integration__loading" role="status">
          Carregando as automações…
        </p>
      )}
      {overview && (
        <>
          <StageNotice writeEnabled={overview.writeEnabled} />
          {overview.canManage && (
            <div className="automations__toolbar">
              <Link to="nova" className="action-button action-button--primary">
                <Plus aria-hidden="true" /> Nova automação
              </Link>
            </div>
          )}
          <dl className="automations__stats">
            <div>
              <dt>Ativas</dt>
              <dd>{numberText(overview.totals.active)}</dd>
            </div>
            <div>
              <dt>DMs enviadas</dt>
              <dd>{numberText(overview.totals.dmsSent)}</dd>
            </div>
            <div>
              <dt>Cliques em links</dt>
              <dd>{numberText(overview.totals.linkClicks)}</dd>
            </div>
          </dl>

          {overview.automations.length === 0 ? (
            <p className="automations__empty">Nenhuma automação nas contas desta empresa ainda.</p>
          ) : (
            <ul className="automations__list" aria-label="Automações">
              {overview.automations.map((automation) => (
                <AutomationRow key={automation.id} automation={automation} />
              ))}
            </ul>
          )}

          {overview.accounts.length > 0 && (
            <div className="automations__accounts">
              <h3>Contas da empresa na Zernio</h3>
              <ul>
                {overview.accounts.map((account) => (
                  <li key={account.id}>
                    <PlatformBadge platform={account.platform} small /> <strong>{account.name}</strong>
                    <span>
                      {platformLabel(account.platform)}: {CAPABILITY_TEXT[account.capability]}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <FlowsSection api={api} />

      <div className="automations__templates">
        <h3>Modelos</h3>
        <ul>
          {TEMPLATES.map((template) => (
            <li key={template.title} className="automation-template">
              <template.icon className="automation-template__icon" aria-hidden="true" />
              <div>
                <strong>{template.title}</strong>
                <p>{template.text}</p>
                <span className="automation-template__networks">{template.networks}</span>
              </div>
              {!template.template ? (
                <StatusBadge tone="development">Próxima etapa</StatusBadge>
              ) : overview?.canManage ? (
                <Link
                  to={template.template === 'fluxo' ? 'nova-fluxo' : template.template === 'pergunta' ? 'nova-pergunta' : `nova?modelo=${template.template}`}
                  className="action-button"
                  aria-label={`Usar o modelo ${template.title}`}
                >
                  Usar modelo
                </Link>
              ) : (
                <StatusBadge tone="neutral">Dono e administradores</StatusBadge>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/**
 * Links de conversa (A5): cada um é um fluxo da Zernio (ig.me/m/<conta>?ref=…). Nasce pausado; ativar pede confirmação,
 * e excluir também. Só dono e administradores alteram; os demais leem.
 */
function FlowsSection({ api }: { api: AutomationsApi }) {
  const [list, setList] = useState<FlowsList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [qrOf, setQrOf] = useState<{ id: string; dataUrl: string } | null>(null);

  /** QR code gerado pelo servidor; clicar de novo esconde */
  async function showQr(flow: FlowSummary) {
    if (qrOf?.id === flow.id) return setQrOf(null);
    const result = await api.flowQr(flow.id);
    if (!result.ok) return setError(result.message);
    setQrOf({ id: flow.id, dataUrl: result.data.dataUrl });
  }

  async function reload(signal?: AbortSignal) {
    const result = await api.flows(signal);
    if (signal?.aborted) return;
    if (!result.ok) return setError(result.message);
    setError(null);
    setList(result.data);
  }

  useEffect(() => {
    const controller = new AbortController();
    void reload(controller.signal);
    return () => controller.abort();
  }, [api]);

  async function toggle(flow: FlowSummary) {
    const question = flow.isActive ? `Pausar o link "${flow.name}"? Quem tocar nele deixa de receber a conversa automática.` : `Ativar o link "${flow.name}"? A partir de agora, quem tocar nele recebe a mensagem.`;
    if (!window.confirm(question)) return;
    setBusy(flow.id);
    const result = await api.setFlowState(flow.id, !flow.isActive);
    setBusy(null);
    if (!result.ok) return setError(result.message);
    await reload();
  }

  async function remove(flow: FlowSummary) {
    if (!window.confirm(`Excluir o link "${flow.name}"? Ele deixa de funcionar e as conversas dele são apagadas na Zernio.`)) return;
    setBusy(flow.id);
    const result = await api.removeFlow(flow.id);
    setBusy(null);
    if (!result.ok) return setError(result.message);
    await reload();
  }

  const actionsAllowed = list !== null && list.canManage && list.writeEnabled;

  return (
    <div className="automations__flows">
      <h3>Links de conversa</h3>
      {error && (
        <p className="auth-alert" role="alert">
          {error}
        </p>
      )}
      {!list && !error && (
        <p className="integration__loading" role="status">
          Carregando os links…
        </p>
      )}
      {list && list.flows.length === 0 && <p className="automations__empty">Nenhum link de conversa ainda.</p>}
      {list && list.flows.length > 0 && (
        <ul className="automations__list" aria-label="Links de conversa">
          {list.flows.map((flow) => (
            <li key={flow.id} className="automations__flow">
              <div>
                <strong>{flow.name}</strong> <StateBadge active={flow.isActive} />
              </div>
              <span>
                {flow.accountName ?? 'Conta fora da empresa'} · {numberText(flow.totalStarted)} conversas iniciadas
              </span>
              {flow.link ? (
                <div className="automations__flow-link">
                  <code>{flow.link}</code>
                  <button type="button" className="action-button" aria-label={`Copiar link de ${flow.name}`} onClick={() => void navigator.clipboard?.writeText(flow.link ?? '')}>
                    <Copy aria-hidden="true" /> Copiar
                  </button>
                </div>
              ) : (
                <span className="field__hint">
                  {flow.kind === 'question'
                    ? 'Pergunta antes do link: a conversa começa com um comentário; o link sai depois da resposta.'
                    : 'Este fluxo não foi criado pelo DisparaZap: o link não aparece aqui.'}
                </span>
              )}
              {flow.link && (
                <button type="button" className="action-button" aria-expanded={qrOf?.id === flow.id} onClick={() => void showQr(flow)}>
                  <QrCode aria-hidden="true" /> {qrOf?.id === flow.id ? 'Ocultar QR code' : 'Ver QR code'}
                </button>
              )}
              {qrOf?.id === flow.id && <img className="automations__flow-qr" src={qrOf.dataUrl} alt={`QR code do link de ${flow.name}`} width={160} height={160} />}
              {actionsAllowed && (
                <div className="automations__flow-actions">
                  <button type="button" className="action-button" disabled={busy === flow.id} onClick={() => void toggle(flow)}>
                    {flow.isActive ? 'Pausar' : 'Ativar'}
                  </button>
                  <button type="button" className="action-button" disabled={busy === flow.id} onClick={() => void remove(flow)}>
                    Excluir
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {actionsAllowed && (
        <div className="automations__toolbar">
          <Link to="nova-fluxo" className="action-button">
            <Plus aria-hidden="true" /> Novo link → conversa
          </Link>
          <Link to="nova-pergunta" className="action-button">
            <Plus aria-hidden="true" /> Novo comentário → perguntar antes
          </Link>
        </div>
      )}
    </div>
  );
}

function AutomationRow({ automation }: { automation: AutomationSummary }) {
  const Icon = TRIGGER_ICONS[automation.trigger] ?? MessageCircle;
  return (
    <li>
      <Link to={encodeURIComponent(automation.id)} className="automation-row">
        <Icon className="automation-row__icon" aria-hidden="true" />
        <span className="automation-row__main">
          <strong className="automation-row__name">{automation.name}</strong>
          <span className="automation-row__sentence">{automationSentence(automation)}</span>
          <span className="automation-row__meta">
            <PlatformBadge platform={automation.platform} small /> {automation.accountName} · {repeatText(automation)} · {numberText(automation.stats.dmsSent)} DMs · {numberText(automation.stats.linkClicks)} cliques
          </span>
        </span>
        <StateBadge active={automation.isActive} />
      </Link>
    </li>
  );
}

/** Gatilhos que o construtor edita (A2 e A3); os demais foram criados no painel da Zernio */
const EDITABLE_TRIGGERS: readonly string[] = ['comment', 'story_mention'];

const lowerFirst = (text: string) => text.charAt(0).toLocaleLowerCase('pt-BR') + text.slice(1);

const activityWhen = (at: string | null) => (at ? new Date(at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');

/**
 * Atividade (A4): quem recebeu, quem foi pulado e por quê. Atualiza sozinha a cada 15 s, só enquanto a página
 * estiver aberta (decisão A9). Comentários que não casaram, com nome e texto, só para dono e administradores (A7).
 */
function AutomationActivityPanel({ api, automationId }: { api: AutomationsApi; automationId: string }) {
  const [activity, setActivity] = useState<AutomationActivity | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let controller: AbortController | null = null;
    const load = () => {
      controller?.abort();
      const current = new AbortController();
      controller = current;
      void api.activity(automationId, current.signal).then((result) => {
        if (current.signal.aborted) return;
        if (!result.ok) return setError(result.message);
        setError(null);
        setActivity(result.data);
      });
    };
    load();
    const timer = setInterval(load, ACTIVITY_REFRESH_MS);
    return () => {
      clearInterval(timer);
      controller?.abort();
    };
  }, [api, automationId]);

  return (
    <section className="automation-activity" aria-labelledby="automacao-atividade">
      <h3 id="automacao-atividade">Atividade</h3>
      <p className="field__hint">Atualiza sozinha a cada 15 segundos, enquanto esta página estiver aberta.</p>
      {error && (
        <p className="auth-alert" role="alert">
          {error}
        </p>
      )}
      {!activity && !error && (
        <p className="integration__loading" role="status">
          Carregando a atividade…
        </p>
      )}
      {activity && activity.entries.length === 0 && <p className="automations__empty">Nenhum envio ainda.</p>}
      {activity && activity.entries.length > 0 && (
        <ul className="automation-activity__list" aria-label="Registros de envio">
          {activity.entries.map((entry) => (
            <li key={entry.id}>
              <time dateTime={entry.at ?? undefined}>{activityWhen(entry.at)}</time> <strong>{entry.label}</strong>
              {entry.clicks > 0 && <span> · {numberText(entry.clicks)} cliques no link</span>}
            </li>
          ))}
        </ul>
      )}
      {activity?.misses && (
        <div className="automation-activity__misses">
          <h4>Comentários que não casaram ({numberText(activity.misses.total)})</h4>
          <p className="field__hint">Visível só para dono e administradores. São comentários com nome e texto de outras pessoas.</p>
          {activity.misses.samples.length === 0 ? (
            <p className="automations__empty">Nenhum nos últimos dias.</p>
          ) : (
            <ul aria-label="Comentários que não casaram">
              {activity.misses.samples.map((sample, index) => (
                <li key={`${sample.at ?? index}-${index}`}>
                  <strong>{sample.commenterName ?? 'Alguém'}</strong>: “{sample.commentText ?? ''}” <span className="field__hint">{activityWhen(sample.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function AutomationDetailView({ api, basePath }: { api: AutomationsApi; basePath: string }) {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<AutomationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'activate' | 'delete' | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function changeState(active: boolean) {
    if (!detail) return;
    setBusy(true);
    setActionError(null);
    setFeedback(null);
    const result = await api.setState(detail.automation.id, active);
    setBusy(false);
    setConfirm(null);
    if (!result.ok) return setActionError(result.message);
    setDetail(result.data);
    setFeedback(result.data.automation.isActive ? 'Automação ativada.' : 'Automação pausada.');
  }

  async function remove() {
    if (!detail) return;
    setBusy(true);
    setActionError(null);
    const result = await api.remove(detail.automation.id);
    setBusy(false);
    setConfirm(null);
    if (!result.ok) return setActionError(result.message);
    navigate(basePath);
  }

  useEffect(() => {
    const controller = new AbortController();
    setDetail(null);
    setError(null);
    void api.detail(id, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (!result.ok) return setError(result.message);
      setDetail(result.data);
    });
    return () => controller.abort();
  }, [api, id]);

  const automation = detail?.automation;
  return (
    <section className="card automation-detail" aria-label="Automação">
      <Link to=".." relative="path" className="automation-detail__back">
        <ArrowLeft aria-hidden="true" /> Automações
      </Link>
      {error && (
        <p className="auth-alert" role="alert">
          {error}
        </p>
      )}
      {!detail && !error && (
        <p className="integration__loading" role="status">
          Carregando a automação…
        </p>
      )}
      {detail && automation && (
        <>
          <header className="automation-detail__head">
            <h2 className="card__title">{automation.name}</h2>
            <StateBadge active={automation.isActive} />
            <span className="automation-detail__account">
              <PlatformBadge platform={automation.platform} small /> {automation.accountName}
            </span>
          </header>

          {detail.canManage && (
            <div className="automation-detail__actions" role="group" aria-label="Ações da automação">
              {EDITABLE_TRIGGERS.includes(automation.trigger) ? (
                <Link to="editar" className="action-button">
                  Editar
                </Link>
              ) : (
                <p className="field__hint">Criada no painel da Zernio com um gatilho que o DisparaZap ainda não edita.</p>
              )}
              {automation.isActive ? (
                <button type="button" className="action-button" disabled={!detail.writeEnabled || busy} onClick={() => void changeState(false)}>
                  Pausar
                </button>
              ) : (
                <button type="button" className="action-button action-button--primary" disabled={!detail.writeEnabled || busy} onClick={() => setConfirm('activate')}>
                  Ativar
                </button>
              )}
              <button type="button" className="action-button action-button--danger" disabled={!detail.writeEnabled || busy} onClick={() => setConfirm('delete')}>
                Excluir
              </button>
              {!detail.writeEnabled && <p className="field__hint">Ativar, pausar e excluir estão desligados nesta plataforma até a homologação.</p>}
            </div>
          )}
          {confirm === 'activate' && (
            <div className="automation-confirm" role="alertdialog" aria-labelledby="confirmar-ativacao" aria-describedby="confirmar-ativacao-texto">
              <p id="confirmar-ativacao">
                <strong>Ativar “{automation.name}”?</strong>
              </p>
              <p id="confirmar-ativacao-texto">
                A partir de agora, {lowerFirst(whenText(automation))}, a automação {thenText(automation)} sozinha. São mensagens reais, enviadas pela conta {automation.accountName}.
              </p>
              <div className="automation-confirm__buttons">
                <button type="button" className="action-button action-button--primary" disabled={busy} onClick={() => void changeState(true)}>
                  Confirmar ativação
                </button>
                <button type="button" className="action-button" onClick={() => setConfirm(null)}>
                  Cancelar
                </button>
              </div>
            </div>
          )}
          {confirm === 'delete' && (
            <div className="automation-confirm" role="alertdialog" aria-labelledby="confirmar-exclusao" aria-describedby="confirmar-exclusao-texto">
              <p id="confirmar-exclusao">
                <strong>Excluir “{automation.name}”?</strong>
              </p>
              <p id="confirmar-exclusao-texto">A automação deixa de existir na Zernio, e isso não pode ser desfeito.</p>
              <div className="automation-confirm__buttons">
                <button type="button" className="action-button action-button--danger" disabled={busy} onClick={() => void remove()}>
                  Confirmar exclusão
                </button>
                <button type="button" className="action-button" onClick={() => setConfirm(null)}>
                  Cancelar
                </button>
              </div>
            </div>
          )}
          {feedback && (
            <p className="automation-detail__feedback" role="status">
              {feedback}
            </p>
          )}
          {actionError && (
            <p className="auth-alert" role="alert">
              {actionError}
            </p>
          )}

          <div className="automation-detail__grid">
            <div>
              <h3>Como funciona</h3>
              <dl className="automation-detail__how">
                <dt>Quando</dt>
                <dd>{whenText(automation)}</dd>
                {automation.keywords.length > 0 && (
                  <>
                    <dt>Palavras-chave</dt>
                    <dd>
                      {keywordsText(automation.keywords)}, {matchModeText(automation.matchMode)}
                    </dd>
                  </>
                )}
                <dt>Então</dt>
                <dd>
                  {thenText(automation)}
                  {automation.followersOnly ? ', só para seguidores' : ''}
                </dd>
                <dt>Com que frequência</dt>
                <dd>{repeatText(automation)}</dd>
                <dt>Só seguidores</dt>
                <dd>{automation.followersOnly ? 'Sim: quem a Zernio ainda não sabe se segue a conta recebe primeiro a verificação' : 'Não: vale para todos'}</dd>
                <dt>Responde também por DM</dt>
                <dd>{detail.alsoMatchInDms ? 'Sim: quem mandar a palavra por DM também recebe a resposta' : 'Não'}</dd>
              </dl>
            </div>

            <div>
              <h3>O que a pessoa recebe</h3>
              {detail.followGate && (
                <>
                  <div className="automation-bubble" aria-label="Verificação de seguidor">
                    <span className="automation-bubble__label">Verificação</span>
                    <p>{detail.followGate.message}</p>
                    <ul className="automation-bubble__buttons">
                      <li>{detail.followGate.buttonLabel}</li>
                    </ul>
                  </div>
                  <p className="field__hint">Quem confirma e segue a conta recebe a DM abaixo. Quem ainda não segue recebe: “{detail.followGate.notFollowingMessage}”</p>
                </>
              )}
              {detail.dmMessage ? (
                <div className="automation-bubble" aria-label="Mensagem direta">
                  <span className="automation-bubble__label">DM</span>
                  <p>{detail.dmMessage}</p>
                  {detail.buttons.length > 0 && (
                    <ul className="automation-bubble__buttons" aria-label="Botões da mensagem">
                      {detail.buttons.map((button, index) => (
                        <li key={index}>{button.title}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : (
                <p className="field__hint">Sem DM: {platformLabel(automation.platform)} só permite resposta pública nesta automação.</p>
              )}
              {detail.commentReply && (
                <div className="automation-bubble automation-bubble--public" aria-label="Resposta pública">
                  <span className="automation-bubble__label">
                    Resposta pública{detail.publicReplyPolicy === 'always' ? ' (sempre)' : detail.dmMessage ? ' (depois da DM)' : ''}
                  </span>
                  <p>{detail.commentReply}</p>
                </div>
              )}
            </div>
          </div>

          <dl className="automations__stats">
            <div>
              <dt>Disparos</dt>
              <dd>{numberText(automation.stats.triggered)}</dd>
            </div>
            <div>
              <dt>DMs enviadas</dt>
              <dd>{numberText(automation.stats.dmsSent)}</dd>
            </div>
            <div>
              <dt>DMs com falha</dt>
              <dd>{numberText(automation.stats.dmsFailed)}</dd>
            </div>
            <div>
              <dt>Pessoas</dt>
              <dd>{numberText(automation.stats.uniqueContacts)}</dd>
            </div>
            <div>
              <dt>Cliques</dt>
              <dd>{numberText(automation.stats.linkClicks)}</dd>
            </div>
            {automation.followersOnly && (
              <>
                <div>
                  <dt>Verificações enviadas</dt>
                  <dd>{numberText(automation.stats.followGateSent)}</dd>
                </div>
                <div>
                  <dt>Liberadas por seguidores</dt>
                  <dd>{numberText(automation.stats.followGatePassed)}</dd>
                </div>
              </>
            )}
          </dl>
        </>
      )}
      {detail && <AutomationActivityPanel api={api} automationId={detail.automation.id} />}
    </section>
  );
}

export function AutomationsPage({ item, api }: { item: NavigationItem; api: AutomationsApi }) {
  return (
    <>
      <PageHeader title={item.label} icon={item.icon} description={DESCRIPTION} badge={<InDevelopmentBadge />} />
      <Routes>
        <Route index element={<AutomationsList api={api} />} />
        <Route path="nova" element={<AutomationBuilder api={api} basePath={item.path} mode="create" />} />
        <Route path=":id" element={<AutomationDetailView api={api} basePath={item.path} />} />
        <Route path=":id/editar" element={<AutomationBuilder api={api} basePath={item.path} mode="edit" />} />
        <Route path="nova-fluxo" element={<FlowBuilder api={api} basePath={item.path} />} />
        <Route path="nova-pergunta" element={<QuestionFlowBuilder api={api} basePath={item.path} />} />
      </Routes>
    </>
  );
}
