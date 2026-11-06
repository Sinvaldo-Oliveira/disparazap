import { AlertTriangle, Check, CircleStop, Play, RefreshCw, Rocket, Timer } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { INSTANCE_STATUS_LABELS, MESSAGING_LIMITS, composeMessage, ctaProblem, type Contact, type ContactListSummary, type IntegrationState, type MessageTemplate, type WhatsAppInstance } from '@disparazap/contracts';
import type { NavigationItem } from '../app/navigation';
import { useSession } from '../auth/AuthProvider';
import { Card } from '../components/Card';
import { PageHeader } from '../components/PageHeader';
import { ContactsStep, NEW_LIST, type LogType, type SavedListState } from '../messaging/ContactsStep';
import { formatDuration, formatSeconds, humanDuration, randomBetween, renderMessage } from '../messaging/message-format';
import { EMPTY_DRAFT, MessageStep, NEW_TEMPLATE, draftCta, draftTexts, type MessageDraft, type SavedTemplateState } from '../messaging/MessageStep';
import type { MessagingApi } from '../messaging/messaging-api';
import { readSpreadsheetFile, type ReadSpreadsheet } from '../messaging/spreadsheet';
import type { WhatsAppApi } from '../whatsapp/whatsapp-api';
import { formatPhone } from './WhatsAppPage';

const STEPS = ['Instância', 'Contatos', 'Mensagem', 'Intervalo', 'Disparar'] as const;
const MAX_LOG = 500;
/** Falhas seguidas (de qualquer tipo) que interrompem o disparo: algo está errado para todos */
const MAX_CONSECUTIVE_FAILURES = 5;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Espera em fatias de 250 ms, conferindo o pedido de parada: dá para parar no meio do intervalo */
export type Wait = (ms: number, shouldStop: () => boolean, onTick: (msLeft: number) => void) => Promise<number>;

export const waitInterruptible: Wait = async (ms, shouldStop, onTick) => {
  const started = Date.now();
  while (!shouldStop()) {
    const left = ms - (Date.now() - started);
    if (left <= 0) break;
    onTick(left);
    await sleep(Math.min(250, left));
  }
  return Date.now() - started;
};

interface LogEntry {
  id: number;
  time: string;
  type: LogType;
  message: string;
  detail?: string;
}

interface Summary {
  sent: number;
  errors: number;
  elapsed: number;
  averageDelay: number | null;
  total: number;
  processed: number;
  stoppedByUser: boolean;
  stopReason: string | null;
}

const letter = (index: number) => String.fromCharCode(65 + index);
const contactLabel = (contact: Contact) => (contact.name ? `${contact.name} (${formatPhone(contact.phone)})` : formatPhone(contact.phone));

export interface SendMessagesPageProps {
  item: NavigationItem;
  whatsappApi: WhatsAppApi;
  messagingApi: MessagingApi;
  readSpreadsheet?: ReadSpreadsheet;
  /** Espera entre envios (os testes usam uma sem atraso) */
  wait?: Wait;
  random?: () => number;
}

export function SendMessagesPage({ item, whatsappApi, messagingApi, readSpreadsheet = readSpreadsheetFile, wait = waitInterruptible, random = Math.random }: SendMessagesPageProps) {
  const session = useSession();
  if (!session.organization) {
    return (
      <>
        <PageHeader title={item.label} icon={item.icon} description="Disparo de mensagens para listas de contatos, pela instância de WhatsApp da empresa." />
        <Card title="Sem empresa nesta conta">
          <p className="card__text">O envio de mensagens é feito pelas empresas. Sua conta não está ligada a uma empresa.</p>
        </Card>
      </>
    );
  }
  return <Wizard item={item} whatsappApi={whatsappApi} messagingApi={messagingApi} readSpreadsheet={readSpreadsheet} wait={wait} random={random} />;
}

function Wizard({ item, whatsappApi, messagingApi, readSpreadsheet, wait, random }: Required<SendMessagesPageProps>) {
  const [step, setStep] = useState(1);
  const [stepError, setStepError] = useState<string | null>(null);

  // Etapa 1
  const [instances, setInstances] = useState<WhatsAppInstance[] | null>(null);
  const [integration, setIntegration] = useState<IntegrationState>('ready');
  const [instancesError, setInstancesError] = useState<string | null>(null);
  const [instanceId, setInstanceId] = useState('');
  // Etapa 2
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [saved, setSaved] = useState<SavedListState>(NEW_LIST);
  const [lists, setLists] = useState<ContactListSummary[]>([]);
  const [canSend, setCanSend] = useState(false);
  // Etapa 3: imagem, mensagem, CTA e variações; modelo salvo em uso
  const [draft, setDraft] = useState<MessageDraft>(EMPTY_DRAFT);
  const [savedTemplate, setSavedTemplate] = useState<SavedTemplateState>(NEW_TEMPLATE);
  const [templatesList, setTemplatesList] = useState<MessageTemplate[]>([]);
  // Etapa 4
  const [delayMin, setDelayMin] = useState('10');
  const [delayMax, setDelayMax] = useState('20');
  // Etapa 5
  const [running, setRunning] = useState(false);
  const [confirmStart, setConfirmStart] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [runStatus, setRunStatus] = useState('');
  const [log, setLog] = useState<LogEntry[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const stopRequested = useRef(false);
  const logSeq = useRef(0);
  const logPanel = useRef<HTMLDivElement>(null);
  const autoScroll = useRef(true);
  const stepper = useRef<HTMLElement>(null);

  const instance = instances?.find((candidate) => candidate.id === instanceId) ?? null;

  const addLog = useCallback((type: LogType, text: string, detail?: string) => {
    const entry: LogEntry = { id: ++logSeq.current, time: new Date().toLocaleTimeString('pt-BR'), type, message: text, ...(detail ? { detail } : {}) };
    setLog((current) => [...current, entry].slice(-MAX_LOG));
  }, []);

  const loadInstances = useCallback(async () => {
    setInstancesError(null);
    const result = await whatsappApi.list();
    if (!result.ok) return setInstancesError(result.message);
    setInstances(result.data.instances);
    setIntegration(result.data.integration);
    // Mantém a escolhida; senão, a primeira conectada
    setInstanceId((current) => (result.data.instances.some((i) => i.id === current) ? current : (result.data.instances.find((i) => i.status === 'connected')?.id ?? result.data.instances[0]?.id ?? '')));
  }, [whatsappApi]);

  const loadLists = useCallback(async () => {
    const result = await messagingApi.lists();
    if (!result.ok) return;
    setLists(result.data.lists);
    setCanSend(result.data.canSend);
  }, [messagingApi]);

  const loadTemplates = useCallback(async () => {
    const result = await messagingApi.templates();
    if (result.ok) setTemplatesList(result.data.templates);
  }, [messagingApi]);

  useEffect(() => {
    void loadInstances();
    void loadLists();
    void loadTemplates();
  }, [loadInstances, loadLists, loadTemplates]);

  const changeDraft = (next: MessageDraft) => {
    setDraft(next);
    setSavedTemplate((current) => ({ ...current, dirty: true }));
  };

  // Sair da página interrompe o disparo (o envio roda nesta aba); fechar a aba pede confirmação
  useEffect(() => () => void (stopRequested.current = true), []);
  useEffect(() => {
    if (!running) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [running]);

  useEffect(() => {
    if (autoScroll.current && logPanel.current) logPanel.current.scrollTop = logPanel.current.scrollHeight;
  }, [log]);

  // ----- Regras de cada etapa -----
  const templates = draftTexts(draft);
  const cta = draftCta(draft);
  const min = Number.parseFloat(delayMin);
  const max = Number.parseFloat(delayMax);
  const delayError = !Number.isFinite(min) || min < 1 ? 'O tempo mínimo deve ser de pelo menos 1 segundo.' : !Number.isFinite(max) ? 'Informe o tempo máximo.' : max < min ? 'O tempo máximo deve ser maior ou igual ao tempo mínimo.' : '';

  function errorOf(n: number): string {
    switch (n) {
      case 1:
        if (!instance) return 'Selecione a instância do WhatsApp que vai enviar as mensagens.';
        if (instance.status !== 'connected') return 'A instância escolhida não está conectada. Conecte o número na página WhatsApp e clique em Atualizar.';
        return '';
      case 2:
        return contacts.length ? '' : 'Adicione pelo menos um contato.';
      case 3: {
        if (!draft.body.trim()) return 'Escreva a mensagem principal.';
        const ctaError = ctaProblem(draft.ctaText, draft.ctaUrl);
        if (ctaError) return ctaError;
        if (templates.some((text) => composeMessage(text, cta).length > MESSAGING_LIMITS.messageMax)) return `Cada mensagem (com o CTA) pode ter até ${MESSAGING_LIMITS.messageMax} caracteres.`;
        return '';
      }
      case 4:
        return delayError;
      default:
        return '';
    }
  }

  function goTo(target: number) {
    if (running || target === step || target < 1 || target > STEPS.length) return;
    if (target > step) {
      for (let s = step; s < target; s++) {
        const error = errorOf(s);
        if (error) {
          setStep(s);
          setStepError(error);
          return;
        }
      }
    }
    setStepError(null);
    setConfirmStart(false);
    setStep(target);
    stepper.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }

  // ----- Etapa 5: o disparo -----
  async function run() {
    setConfirmStart(false);
    for (let s = 1; s <= 4; s++) {
      const error = errorOf(s);
      if (error) {
        setStep(s);
        setStepError(error);
        return;
      }
    }
    if (!instance) return;
    const list = contacts.slice();
    const texts = templates.slice();
    const ctaNow = cta;
    const mediaId = draft.mediaId;
    const total = list.length;
    const minMs = Math.round(min * 1000);
    const maxMs = Math.round(max * 1000);

    stopRequested.current = false;
    setRunning(true);
    setSummary(null);
    setProgress({ done: 0, total });
    addLog('sys', `Disparo iniciado: ${total.toLocaleString('pt-BR')} contato(s) · instância "${instance.displayName}" · intervalo ${formatSeconds(min)}–${formatSeconds(max)}` + (texts.length > 1 ? ` · ${texts.length} variações` : '') + (mediaId ? ' · com imagem' : '') + (ctaNow ? ' · com CTA' : ''));

    const started = Date.now();
    const delays: number[] = [];
    let sent = 0;
    let errors = 0;
    let processed = 0;
    let consecutive = 0;
    let stopReason: string | null = null;

    for (let i = 0; i < total; i++) {
      if (stopRequested.current) break;
      const contact = list[i] as Contact;
      const variant = Math.floor(random() * texts.length);
      const label = contactLabel(contact) + (texts.length > 1 ? ` · variação ${letter(variant)}` : '');
      setRunStatus(`Enviando para ${contactLabel(contact)}…`);

      const result = await messagingApi.send(instance.id, contact.phone, composeMessage(renderMessage(texts[variant] ?? '', contact.name), ctaNow), mediaId);
      if (result.ok && result.data.ok) {
        sent++;
        consecutive = 0;
        addLog('ok', label);
      } else {
        errors++;
        consecutive++;
        const failure = result.ok ? (result.data.ok ? null : result.data) : null;
        addLog('err', label, failure ? failure.message : result.ok ? '' : result.message);
        // 400 = só este contato (ex.: texto longo demais depois do {nome}); outros erros da API valem para todos
        if (failure?.stop) stopReason = failure.message;
        else if (!result.ok && result.status !== 400) stopReason = result.message;
        else if (consecutive >= MAX_CONSECUTIVE_FAILURES) stopReason = `${MAX_CONSECUTIVE_FAILURES} falhas seguidas. Confira a instância na página WhatsApp antes de tentar de novo.`;
      }
      processed = i + 1;
      setProgress({ done: processed, total });
      if (stopReason) break;

      if (i < total - 1 && !stopRequested.current) {
        const waited = await wait(randomBetween(minMs, maxMs, random), () => stopRequested.current, (left) => setRunStatus(`Próximo envio em ${Math.ceil(left / 1000)}s`));
        if (!stopRequested.current) delays.push(waited);
      }
    }

    const stoppedByUser = stopRequested.current && !stopReason;
    if (stopReason) addLog('sys', `Disparo interrompido: ${stopReason}`);
    else if (stoppedByUser) addLog('sys', `Disparo interrompido por você: ${processed} de ${total} processado(s).`);
    else addLog('sys', `Disparo concluído: ${sent} enviado(s), ${errors} erro(s).`);

    stopRequested.current = false;
    setRunning(false);
    setRunStatus(stopReason || stoppedByUser ? 'Interrompido' : 'Concluído');
    setSummary({ sent, errors, elapsed: Date.now() - started, averageDelay: delays.length ? delays.reduce((a, b) => a + b, 0) / delays.length : null, total, processed, stoppedByUser, stopReason });
    if (stopReason) void loadInstances();
  }

  function requestStop() {
    if (!running || stopRequested.current) return;
    stopRequested.current = true;
    setRunStatus('Parando…');
    addLog('sys', 'Interrupção pedida: terminando o envio atual…');
  }

  function newDispatch() {
    setContacts([]);
    setSaved(NEW_LIST);
    setSummary(null);
    setRunStatus('');
    setProgress({ done: 0, total: 0 });
    addLog('sys', 'Novo disparo: contatos limpos (instância e mensagem mantidas).');
    setStep(2);
  }

  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const previewContact = contacts[0] ?? { name: 'Contato Exemplo', phone: '5511999999999' };
  const estimate = !delayError && contacts.length > 1 ? `Com ${contacts.length.toLocaleString('pt-BR')} contatos, o disparo deve levar cerca de ${humanDuration((contacts.length - 1) * ((min + max) / 2) * 1000)} (sem contar o tempo de cada envio).` : '';

  return (
    <>
      <PageHeader title={item.label} icon={item.icon} description="Envie mensagens de texto para os seus contatos pela instância de WhatsApp da empresa." />

      <nav className="stepper" aria-label="Etapas do disparo" ref={stepper}>
        <div className="stepper__track" aria-hidden="true">
          <div className="stepper__fill" style={{ width: `${((step - 1) / (STEPS.length - 1)) * 100}%` }} />
        </div>
        <ol className="stepper__list">
          {STEPS.map((label, index) => {
            const n = index + 1;
            return (
              <li key={label}>
                <button type="button" className={`stepper__item${n === step ? ' stepper__item--active' : ''}${n < step ? ' stepper__item--done' : ''}`} aria-current={n === step ? 'step' : undefined} disabled={running} onClick={() => goTo(n)}>
                  <span className="stepper__circle">{n < step ? <Check aria-hidden="true" /> : n}</span>
                  <span className="stepper__label">{label}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <section className="card wizard__card" aria-labelledby="wizard-step-title">
        {step === 1 && (
          <>
            <header className="wizard__head">
              <h2 id="wizard-step-title">Instância</h2>
              <p className="card__text">Escolha a instância do WhatsApp da empresa que vai enviar as mensagens.</p>
            </header>
            {integration !== 'ready' && <p className="auth-alert" role="note">A integração com o WhatsApp não está disponível. Fale com o administrador da plataforma.</p>}
            {instancesError && <p className="auth-alert" role="alert">{instancesError}</p>}
            {instances && instances.length === 0 ? (
              <p className="card__text">
                Sua empresa ainda não tem instância. <Link className="text-link" to={{ pathname: '/integracoes', hash: '#whatsapp' }}>Crie e conecte uma em Integrações</Link>.
              </p>
            ) : (
              <div className="field">
                <label className="field__label" htmlFor="instance-select">Instância</label>
                <div className="wizard__row">
                  <select id="instance-select" className="field__input" value={instanceId} disabled={!instances} onChange={(event) => setInstanceId(event.target.value)}>
                    {!instances && <option value="">Carregando…</option>}
                    {instances?.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.status === 'connected' ? '🟢' : '🔴'} {candidate.displayName}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="action-button" onClick={() => void loadInstances()}>
                    <RefreshCw aria-hidden="true" /> Atualizar
                  </button>
                </div>
                {instance && (
                  <p className={`wizard__status wizard__status--${instance.status === 'connected' ? 'on' : 'off'}`} role="status">
                    <span className="wizard__dot" aria-hidden="true" /> {INSTANCE_STATUS_LABELS[instance.status]}
                    {instance.phone ? ` · ${formatPhone(instance.phone)}` : ''}
                    {instance.status !== 'connected' && (
                      <>
                        {' · '}
                        <Link className="text-link" to={{ pathname: '/integracoes', hash: '#whatsapp' }}>conectar em Integrações</Link>
                      </>
                    )}
                  </p>
                )}
              </div>
            )}
            <p className="field__hint">O token da instância fica guardado com segurança no servidor: não precisa informar nada aqui.</p>
          </>
        )}

        {step === 2 && (
          <>
            <header className="wizard__head">
              <h2 id="wizard-step-title">Contatos</h2>
              <p className="card__text">Use uma lista salva ou monte uma nova: adicione contatos manualmente ou importe uma planilha Excel.</p>
            </header>
            <ContactsStep api={messagingApi} readSpreadsheet={readSpreadsheet} contacts={contacts} onContactsChange={setContacts} saved={saved} onSavedChange={setSaved} lists={lists} onListsChanged={() => void loadLists()} canSave={canSend} locked={running} log={addLog} />
          </>
        )}

        {step === 3 && (
          <>
            <header className="wizard__head">
              <h2 id="wizard-step-title">Mensagem</h2>
              <p className="card__text">Monte o que será enviado: imagem, texto e chamada para ação. Salve como modelo para reutilizar nos próximos disparos.</p>
            </header>
            <MessageStep api={messagingApi} draft={draft} onDraftChange={changeDraft} saved={savedTemplate} onSavedChange={setSavedTemplate} templates={templatesList} onTemplatesChanged={() => void loadTemplates()} canSave={canSend} previewContact={previewContact} />
          </>
        )}

        {step === 4 && (
          <>
            <header className="wizard__head">
              <h2 id="wizard-step-title">Intervalo entre envios</h2>
              <p className="card__text">Um tempo aleatório entre o mínimo e o máximo é aguardado entre cada mensagem.</p>
            </header>
            <div className="wizard__delays">
              <div className="field">
                <label className="field__label" htmlFor="delay-min">Tempo mínimo (segundos)</label>
                <input id="delay-min" className="field__input" type="number" min={1} step={1} value={delayMin} onChange={(event) => setDelayMin(event.target.value)} />
              </div>
              <div className="field">
                <label className="field__label" htmlFor="delay-max">Tempo máximo (segundos)</label>
                <input id="delay-max" className="field__input" type="number" min={1} step={1} value={delayMax} onChange={(event) => setDelayMax(event.target.value)} />
              </div>
            </div>
            <div className="wizard__delay-preview">
              <Timer aria-hidden="true" />
              <div>
                <p>{delayError ? 'Corrija os valores para ver o intervalo.' : <>Aguardará entre <strong>{formatSeconds(min)}</strong> e <strong>{formatSeconds(max)}</strong> entre cada envio</>}</p>
                {estimate && <p className="field__hint">{estimate}</p>}
              </div>
            </div>
            {!delayError && min < 5 && (
              <p className="notice" role="note">
                <AlertTriangle className="notice__icon" aria-hidden="true" /> Intervalos menores que 5 segundos aumentam muito o risco de banimento do número.
              </p>
            )}
            {delayError && <p className="auth-alert" role="alert">{delayError}</p>}
          </>
        )}

        {step === 5 && (
          <>
            <header className="wizard__head">
              <h2 id="wizard-step-title">Disparar</h2>
              <p className="card__text">Confira o resumo e inicie. Você pode parar a qualquer momento.</p>
            </header>
            <dl className="tiles">
              <div className="tile"><dt>Instância</dt><dd>{instance?.displayName ?? '—'}</dd></div>
              <div className="tile"><dt>Contatos</dt><dd>{contacts.length.toLocaleString('pt-BR')}</dd></div>
              <div className="tile"><dt>Intervalo</dt><dd>{delayError ? '—' : `${formatSeconds(min)} – ${formatSeconds(max)}`}</dd></div>
              <div className="tile"><dt>Mensagem</dt><dd>{[draft.mediaId ? 'Imagem' : null, templates.length > 1 ? `${templates.length} variações` : 'Texto', cta ? 'CTA' : null].filter(Boolean).join(' + ')}</dd></div>
            </dl>
            {!canSend && <p className="auth-alert" role="note">Só o dono, os administradores e os operadores da empresa podem enviar mensagens.</p>}
            {confirmStart ? (
              <div className="instance__confirm" role="alertdialog" aria-label="Confirmar disparo">
                <p>
                  Enviar para {contacts.length.toLocaleString('pt-BR')} contato(s) pela instância "{instance?.displayName}"? Mantenha esta página aberta até o fim: sair dela interrompe o envio.
                </p>
                <div className="integration__actions">
                  <button type="button" className="action-button action-button--primary" onClick={() => void run()}>
                    <Play aria-hidden="true" /> Confirmar e iniciar
                  </button>
                  <button type="button" className="action-button" onClick={() => setConfirmStart(false)}>Cancelar</button>
                </div>
              </div>
            ) : (
              <div className="integration__actions">
                <button type="button" className="action-button action-button--primary" disabled={running || !canSend} onClick={() => setConfirmStart(true)}>
                  <Play aria-hidden="true" /> Iniciar disparo
                </button>
                <button type="button" className="action-button action-button--danger" disabled={!running} onClick={requestStop}>
                  <CircleStop aria-hidden="true" /> Parar
                </button>
              </div>
            )}
            <div className="run">
              <div className="run__info">
                <span className="run__count">{progress.done.toLocaleString('pt-BR')} / {(progress.total || contacts.length).toLocaleString('pt-BR')}</span>
                <span className="run__status" role="status">{runStatus}</span>
                <span className="run__pct">{pct}%</span>
              </div>
              <div className="progress" role="progressbar" aria-label="Progresso do disparo" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
                <div className={`progress__bar${running ? ' progress__bar--running' : ''}`} style={{ width: `${pct}%` }} />
              </div>
            </div>
            <div className="log__head">
              <strong>Log</strong>
              <span className="log__legend">
                <span className="log__ok">✓ enviado</span> <span className="log__err">✗ erro</span> <span className="log__sys">◆ sistema</span>
              </span>
            </div>
            <div
              className="log"
              ref={logPanel}
              aria-label="Log do disparo"
              aria-live="polite"
              onScroll={(event) => {
                const panel = event.currentTarget;
                autoScroll.current = panel.scrollHeight - panel.scrollTop - panel.clientHeight < 24;
              }}
            >
              {log.map((entry) => (
                <div key={entry.id} className={`log__line log__line--${entry.type}`}>
                  <span className="log__time">{entry.time}</span>
                  <span aria-hidden="true">{entry.type === 'ok' ? '✓' : entry.type === 'err' ? '✗' : '◆'}</span>
                  <span>
                    {entry.message}
                    {entry.detail && <span className="log__detail"> — {entry.detail}</span>}
                  </span>
                </div>
              ))}
            </div>
            {summary && (
              <section className="summary" aria-label="Resumo do disparo">
                <h3>Resumo do disparo</h3>
                <dl className="tiles">
                  <div className="tile tile--ok"><dt>Enviados</dt><dd>{summary.sent.toLocaleString('pt-BR')}</dd></div>
                  <div className="tile tile--err"><dt>Erros</dt><dd>{summary.errors.toLocaleString('pt-BR')}</dd></div>
                  <div className="tile"><dt>Tempo total</dt><dd>{formatDuration(summary.elapsed)}</dd></div>
                  <div className="tile"><dt>Intervalo médio</dt><dd>{summary.averageDelay === null ? '—' : `${(summary.averageDelay / 1000).toFixed(1)}s`}</dd></div>
                </dl>
                {summary.stopReason && <p className="auth-alert" role="alert">Disparo interrompido: {summary.stopReason}</p>}
                {summary.stoppedByUser && (
                  <p className="notice" role="note">
                    <AlertTriangle className="notice__icon" aria-hidden="true" /> Disparo interrompido por você: {summary.total - summary.processed} de {summary.total} contato(s) não foram processados.
                  </p>
                )}
                <div className="integration__actions">
                  <button type="button" className="action-button action-button--primary" onClick={newDispatch}>
                    <Rocket aria-hidden="true" /> Iniciar novo disparo
                  </button>
                </div>
              </section>
            )}
          </>
        )}

        {stepError && <p className="auth-alert" role="alert">{stepError}</p>}
      </section>

      <div className="wizard__nav">
        <button type="button" className="action-button" disabled={step === 1 || running} onClick={() => goTo(step - 1)}>
          ← Voltar
        </button>
        <span className="field__hint">Etapa {step} de {STEPS.length}</span>
        {step < STEPS.length ? (
          <button type="button" className="action-button action-button--primary" onClick={() => goTo(step + 1)}>
            Próximo →
          </button>
        ) : (
          <span />
        )}
      </div>
      <p className="field__hint wizard__footer">Use com responsabilidade: envie apenas para quem autorizou receber suas mensagens.</p>
    </>
  );
}
