import { ArrowLeft, Info, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  AUTOMATION_LIMITS,
  AUTOMATION_INPUT_LIMITS,
  automationInputProblem,
  automationInputSchema,
  type AutomationAccount,
  type AutomationCapability,
  type AutomationInput,
} from '@disparazap/contracts';
import type { AutomationsApi } from '../../automations/automations-api';
import { CAPABILITY_TEXT } from '../../automations/automation-text';
import { platformLabel } from '../../components/PlatformBadge';

/**
 * Construtor de automação (PLANO_MODULO_AUTOMACOES):
 * - A2: Comentário → DM (Instagram e Facebook) e Comentário → resposta pública (TikTok, Threads, LinkedIn e YouTube);
 * - A3: Só seguidores (verificação antes da recompensa) e Menção em story → DM, só no Instagram.
 * Toda automação é salva pausada; ativar é outra ação, com confirmação, na página da automação. As regras são as
 * mesmas da API (contrato compartilhado).
 */

type Template = 'dm' | 'resposta' | 'seguidores' | 'story';
type Trigger = AutomationInput['trigger'];
interface ButtonDraft {
  title: string;
  url: string;
}

const TEMPLATES: readonly Template[] = ['dm', 'resposta', 'seguidores', 'story'];

/** Nome e @ de exemplo da prévia (fictícios) */
const SAMPLE = { firstName: 'Ana', name: 'Ana Souza', username: 'ana.cliente' };
export function personalize(text: string): string {
  return text
    .replace(/\{\{\s*first_name\s*\}\}/gi, SAMPLE.firstName)
    .replace(/\{\{\s*name\s*\}\}/gi, SAMPLE.name)
    .replace(/\{\{\s*username\s*\}\}/gi, SAMPLE.username);
}

/** Textos iniciais da verificação de seguidor (a empresa pode trocar) */
const GATE_DEFAULTS = {
  message: 'Quase lá! Toque no botão para confirmar que você segue a conta.',
  buttonLabel: 'Já sigo',
  notFollowingMessage: 'Ainda não encontramos você entre os seguidores. Siga a conta e toque no botão de novo.',
};

const splitKeywords = (text: string) =>
  text
    .split(',')
    .map((word) => word.trim())
    .filter(Boolean);

const usable = (account: AutomationAccount) => account.capability !== 'unsupported';

function defaultAccount(accounts: readonly AutomationAccount[], template: Template | null): AutomationAccount | undefined {
  if (template === 'resposta') return accounts.find((account) => account.capability === 'public_reply');
  if (template === 'seguidores' || template === 'story') return accounts.find((account) => account.capability === 'full');
  if (template === 'dm') return accounts.find((account) => account.capability === 'full' || account.capability === 'dm');
  return accounts.find(usable);
}

const TEMPLATE_NAMES: Readonly<Record<Template, string>> = {
  dm: 'Comentário → DM',
  resposta: 'Resposta pública',
  seguidores: 'Só seguidores',
  story: 'Agradecer menção no story',
};

export function AutomationBuilder({ api, basePath, mode }: { api: AutomationsApi; basePath: string; mode: 'create' | 'edit' }) {
  const navigate = useNavigate();
  const { id = '' } = useParams();
  const [search] = useSearchParams();
  const requested = search.get('modelo');
  const template: Template | null = TEMPLATES.find((item) => item === requested) ?? null;

  const [accounts, setAccounts] = useState<AutomationAccount[] | null>(null);
  const [writeEnabled, setWriteEnabled] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [accountId, setAccountId] = useState('');
  const [name, setName] = useState('');
  const [trigger, setTrigger] = useState<Trigger>('comment');
  const [keywords, setKeywords] = useState('');
  const [matchMode, setMatchMode] = useState<AutomationInput['matchMode']>('word');
  const [followersOnly, setFollowersOnly] = useState(false);
  const [gateMessage, setGateMessage] = useState(GATE_DEFAULTS.message);
  const [gateButton, setGateButton] = useState(GATE_DEFAULTS.buttonLabel);
  const [gateNotFollowing, setGateNotFollowing] = useState(GATE_DEFAULTS.notFollowingMessage);
  const [dmMessage, setDmMessage] = useState('');
  const [buttons, setButtons] = useState<ButtonDraft[]>([]);
  const [commentReply, setCommentReply] = useState('');
  const [repeatMode, setRepeatMode] = useState<AutomationInput['repeat']['mode']>('once');
  const [cooldownHours, setCooldownHours] = useState('24');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Contas e permissões vêm da visão geral; na edição, os campos vêm da automação (relida na Zernio pela API)
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const overview = await api.overview(controller.signal);
      if (controller.signal.aborted) return;
      if (!overview.ok) return setLoadError(overview.message);
      setAccounts(overview.data.accounts);
      setWriteEnabled(overview.data.writeEnabled);
      setCanManage(overview.data.canManage);
      if (mode === 'create') {
        setAccountId(defaultAccount(overview.data.accounts, template)?.id ?? '');
        setName(template ? TEMPLATE_NAMES[template] : '');
        if (template === 'seguidores') setFollowersOnly(true);
        if (template === 'story') {
          setTrigger('story_mention');
          setRepeatMode('every_comment');
          setCooldownHours('24');
          setDmMessage('Obrigado por mencionar a gente no seu story, {{first_name}}!');
        }
        return;
      }
      const detail = await api.detail(id, controller.signal);
      if (controller.signal.aborted) return;
      if (!detail.ok) return setLoadError(detail.message);
      const { automation, followGate } = detail.data;
      setAccountId(automation.accountId);
      setName(automation.name);
      setTrigger(automation.trigger === 'story_mention' ? 'story_mention' : 'comment');
      setKeywords(automation.keywords.join(', '));
      setMatchMode(automation.matchMode === 'contains' || automation.matchMode === 'exact' ? automation.matchMode : 'word');
      setFollowersOnly(automation.followersOnly);
      if (followGate) {
        setGateMessage(followGate.message);
        setGateButton(followGate.buttonLabel);
        setGateNotFollowing(followGate.notFollowingMessage);
      }
      setDmMessage(detail.data.dmMessage ?? '');
      setButtons(detail.data.buttons.map((button) => ({ title: button.title, url: button.url ?? '' })));
      setCommentReply(detail.data.commentReply ?? '');
      setRepeatMode(automation.repeat.mode);
      setCooldownHours(String(automation.repeat.cooldownHours ?? 24));
    })();
    return () => controller.abort();
  }, [api, id, mode, template]);

  const account = accounts?.find((item) => item.id === accountId);
  const capability: AutomationCapability = account?.capability ?? 'unsupported';
  const instagram = capability === 'full';
  const story = trigger === 'story_mention';
  const dmAllowed = capability === 'full' || capability === 'dm';
  const gateShown = instagram && !story;
  const gated = gateShown && followersOnly;
  const dmMax = buttons.length > 0 ? AUTOMATION_LIMITS.dmWithButtons : AUTOMATION_LIMITS.dmWithoutButtons;
  const firstKeyword = splitKeywords(keywords)[0];
  const canSave = writeEnabled && canManage && !saving;
  const backTo = mode === 'edit' ? `${basePath}/${encodeURIComponent(id)}` : basePath;

  function changeAccount(next: string) {
    setAccountId(next);
    // Story e "só seguidores" existem só no Instagram: em outra rede, voltam ao padrão
    if (accounts?.find((item) => item.id === next)?.capability !== 'full') {
      setTrigger('comment');
      setFollowersOnly(false);
    }
  }

  function buildInput(): AutomationInput {
    return {
      accountId,
      name,
      trigger,
      keywords: story ? [] : splitKeywords(keywords),
      matchMode,
      followGate: gated ? { message: gateMessage.trim(), buttonLabel: gateButton.trim(), notFollowingMessage: gateNotFollowing.trim() } : null,
      dmMessage: dmAllowed ? dmMessage.trim() || null : null,
      buttons: dmAllowed ? buttons.map((button) => ({ title: button.title.trim(), url: button.url.trim() })) : [],
      commentReply: story ? null : commentReply.trim() || null,
      repeat: { mode: repeatMode, cooldownHours: repeatMode === 'every_comment' ? Number.parseInt(cooldownHours, 10) || null : null },
    };
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSave) return;
    const input = buildInput();
    const parsed = automationInputSchema.safeParse(input);
    const problem = parsed.success ? automationInputProblem(parsed.data, capability) : (parsed.error.issues[0]?.message ?? 'Confira os campos.');
    if (problem) return setError(problem);
    setError(null);
    setSaving(true);
    const { accountId: _account, ...fields } = input;
    const result = mode === 'create' ? await api.create(input) : await api.update(id, fields);
    setSaving(false);
    if (!result.ok) return setError(result.message);
    navigate(`${basePath}/${encodeURIComponent(result.data.automation.id)}`);
  }

  const insertToken = (token: string) => setDmMessage((text) => (text && !text.endsWith(' ') ? `${text} ${token}` : `${text}${token}`));
  const updateButton = (index: number, field: keyof ButtonDraft, value: string) => setButtons((list) => list.map((button, at) => (at === index ? { ...button, [field]: value } : button)));

  if (loadError) {
    return (
      <section className="card automation-builder" aria-label="Construtor de automação">
        <Link to={backTo} className="automation-detail__back">
          <ArrowLeft aria-hidden="true" /> Voltar
        </Link>
        <p className="auth-alert" role="alert">
          {loadError}
        </p>
      </section>
    );
  }
  if (!accounts) {
    return (
      <section className="card automation-builder" aria-label="Construtor de automação">
        <p className="integration__loading" role="status">
          Carregando…
        </p>
      </section>
    );
  }

  return (
    <form className="card automation-builder" aria-label="Construtor de automação" onSubmit={(event) => void save(event)} noValidate>
      <Link to={backTo} className="automation-detail__back">
        <ArrowLeft aria-hidden="true" /> {mode === 'edit' ? 'Voltar para a automação' : 'Automações'}
      </Link>
      <h2 className="card__title">{mode === 'edit' ? 'Editar automação' : 'Nova automação'}</h2>

      {!canManage && (
        <div className="notice" role="status">
          <Info className="notice__icon" aria-hidden="true" />
          <p>Só o dono e os administradores da empresa criam e alteram automações.</p>
        </div>
      )}
      {canManage && !writeEnabled && (
        <div className="notice" role="status">
          <Info className="notice__icon" aria-hidden="true" />
          <p>Salvar está desligado nesta plataforma até a homologação. Você pode montar a automação e ver a prévia.</p>
        </div>
      )}

      <div className="automation-builder__layout">
        <ol className="automation-builder__steps">
          <li className="builder-card">
            <h3>Quando</h3>
            <label className="field">
              <span className="field__label">Conta</span>
              <select className="field__input" value={accountId} disabled={mode === 'edit'} onChange={(event) => changeAccount(event.target.value)}>
                {mode === 'create' && <option value="">Escolha a conta</option>}
                {accounts.filter(usable).map((item) => (
                  <option key={item.id} value={item.id}>
                    {`${platformLabel(item.platform)} ${item.name} (${CAPABILITY_TEXT[item.capability]})`}
                  </option>
                ))}
              </select>
              {mode === 'edit' && <span className="field__hint">Para usar outra conta, crie outra automação.</span>}
            </label>
            <label className="field">
              <span className="field__label">Nome da automação</span>
              <input className="field__input" value={name} maxLength={AUTOMATION_INPUT_LIMITS.nameMax} onChange={(event) => setName(event.target.value)} />
            </label>
            {instagram && (
              <label className="field">
                <span className="field__label">O que dispara</span>
                <select className="field__input" value={trigger} disabled={mode === 'edit'} onChange={(event) => setTrigger(event.target.value as Trigger)}>
                  <option value="comment">Comentário com palavra-chave</option>
                  <option value="story_mention">Menção à conta num story</option>
                </select>
              </label>
            )}
            {story ? (
              <p className="field__hint">Toda menção à conta num story dispara a automação: a menção não tem palavras e o Instagram não informa qual story foi.</p>
            ) : (
              <>
                <label className="field">
                  <span className="field__label">Palavras-chave</span>
                  <input className="field__input" value={keywords} placeholder="preço, valor, link" onChange={(event) => setKeywords(event.target.value)} />
                  <span className="field__hint">Separe por vírgula. Use palavras específicas: uma palavra comum pode gerar muitas mensagens.</span>
                </label>
                <label className="field">
                  <span className="field__label">Como procurar</span>
                  <select className="field__input" value={matchMode} onChange={(event) => setMatchMode(event.target.value as AutomationInput['matchMode'])}>
                    <option value="word">Como palavra inteira</option>
                    <option value="contains">Em qualquer parte do comentário</option>
                    <option value="exact">Só o comentário exato</option>
                  </select>
                </label>
                <p className="field__hint">Onde: em qualquer publicação da conta. Escolher uma publicação específica chega numa próxima etapa.</p>
              </>
            )}
          </li>

          {gateShown && (
            <li className="builder-card">
              <h3>Verificação</h3>
              <label className="automation-builder__radio">
                <input type="checkbox" checked={followersOnly} onChange={(event) => setFollowersOnly(event.target.checked)} /> Só para quem segue a conta
              </label>
              {followersOnly && (
                <>
                  <p className="field__hint">O Instagram só informa quem segue a conta depois que a pessoa manda uma mensagem. Por isso, quem a Zernio ainda não conhece recebe primeiro um botão para confirmar; depois do toque, a Zernio confere e entrega a recompensa.</p>
                  <label className="field">
                    <span className="field__label">Mensagem de verificação</span>
                    <textarea className="field__input" rows={2} value={gateMessage} maxLength={AUTOMATION_LIMITS.dmWithButtons} onChange={(event) => setGateMessage(event.target.value)} />
                  </label>
                  <label className="field">
                    <span className="field__label">Rótulo do botão de confirmação</span>
                    <input className="field__input" value={gateButton} maxLength={AUTOMATION_LIMITS.buttonTitleMax} onChange={(event) => setGateButton(event.target.value)} />
                  </label>
                  <label className="field">
                    <span className="field__label">Mensagem para quem ainda não segue</span>
                    <textarea className="field__input" rows={2} value={gateNotFollowing} maxLength={AUTOMATION_LIMITS.dmWithoutButtons} onChange={(event) => setGateNotFollowing(event.target.value)} />
                  </label>
                </>
              )}
            </li>
          )}

          <li className="builder-card">
            <h3>Então</h3>
            {dmAllowed ? (
              <>
                <label className="field">
                  <span className="field__label">{gated ? 'Texto da DM (a recompensa)' : 'Texto da DM'}</span>
                  <textarea className="field__input" rows={4} value={dmMessage} maxLength={AUTOMATION_LIMITS.dmWithoutButtons} onChange={(event) => setDmMessage(event.target.value)} />
                  <span className="field__hint">
                    {dmMessage.length}/{dmMax} caracteres{buttons.length > 0 ? ' (com botões)' : ''}
                  </span>
                </label>
                <div className="automation-builder__tokens">
                  <button type="button" className="action-button" onClick={() => insertToken('{{first_name}}')}>
                    Inserir nome
                  </button>
                  <button type="button" className="action-button" onClick={() => insertToken('{{username}}')}>
                    Inserir @usuário
                  </button>
                </div>
                <fieldset className="automation-builder__buttons">
                  <legend>Botões de link (até {AUTOMATION_LIMITS.buttonsMax})</legend>
                  {buttons.map((button, index) => (
                    <div key={index} className="automation-builder__button-row">
                      <label className="field">
                        <span className="field__label">Rótulo do botão {index + 1}</span>
                        <input className="field__input" value={button.title} maxLength={AUTOMATION_LIMITS.buttonTitleMax} onChange={(event) => updateButton(index, 'title', event.target.value)} />
                      </label>
                      <label className="field">
                        <span className="field__label">Link do botão {index + 1}</span>
                        <input className="field__input" type="url" value={button.url} placeholder="https://" onChange={(event) => updateButton(index, 'url', event.target.value)} />
                      </label>
                      <button type="button" className="icon-button" aria-label={`Remover o botão ${index + 1}`} onClick={() => setButtons((list) => list.filter((_, at) => at !== index))}>
                        <Trash2 aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                  <button type="button" className="action-button" disabled={buttons.length >= AUTOMATION_LIMITS.buttonsMax} onClick={() => setButtons((list) => [...list, { title: '', url: '' }])}>
                    <Plus aria-hidden="true" /> Adicionar botão
                  </button>
                  {!story && <p className="field__hint">O Instagram pode recusar botões para quem ainda não segue a conta, e cada comentário aceita uma única resposta privada.</p>}
                </fieldset>
                {!story && (
                  <label className="field">
                    <span className="field__label">Resposta pública no comentário (opcional)</span>
                    <textarea className="field__input" rows={2} value={commentReply} maxLength={AUTOMATION_INPUT_LIMITS.publicReplyMax} onChange={(event) => setCommentReply(event.target.value)} />
                    <span className="field__hint">{gated ? 'Publicada mesmo enquanto a DM espera a confirmação.' : 'Publicada depois da DM.'}</span>
                  </label>
                )}
              </>
            ) : (
              <label className="field">
                <span className="field__label">Resposta pública</span>
                <textarea className="field__input" rows={3} value={commentReply} maxLength={AUTOMATION_INPUT_LIMITS.publicReplyMax} onChange={(event) => setCommentReply(event.target.value)} />
                <span className="field__hint">{account ? `${platformLabel(account.platform)} não permite DM automática: a automação responde só em público.` : 'Escolha a conta.'}</span>
              </label>
            )}
          </li>

          <li className="builder-card">
            <h3>Com que frequência</h3>
            <label className="automation-builder__radio">
              <input type="radio" name="repeat" checked={repeatMode === 'once'} onChange={() => setRepeatMode('once')} /> Uma vez por pessoa
            </label>
            <label className="automation-builder__radio">
              <input type="radio" name="repeat" checked={repeatMode === 'every_comment'} onChange={() => setRepeatMode('every_comment')} /> {story ? 'Toda menção, com espera' : 'Toda vez que a pessoa comentar, com espera'}
            </label>
            {repeatMode === 'every_comment' && (
              <label className="field">
                <span className="field__label">Espera, em horas</span>
                <input className="field__input" type="number" min={AUTOMATION_LIMITS.cooldownHoursMin} max={AUTOMATION_LIMITS.cooldownHoursMax} value={cooldownHours} onChange={(event) => setCooldownHours(event.target.value)} />
              </label>
            )}
          </li>
        </ol>

        <aside className="automation-preview" aria-label="Prévia no celular">
          <div className="automation-preview__phone">
            <p className="automation-preview__comment">
              <strong>{SAMPLE.username}</strong> {story ? 'mencionou você num story' : `comentou: ${firstKeyword ?? 'palavra-chave'}`}
            </p>
            {gated && gateMessage.trim() && (
              <>
                <div className="automation-bubble" aria-label="Prévia da verificação">
                  <span className="automation-bubble__label">Verificação</span>
                  <p>{personalize(gateMessage)}</p>
                  <ul className="automation-bubble__buttons">
                    <li>{gateButton || 'Botão'}</li>
                  </ul>
                </div>
                <p className="field__hint">Depois do toque, a Zernio confere se a pessoa segue e envia:</p>
              </>
            )}
            {dmAllowed && dmMessage.trim() && (
              <div className="automation-bubble" aria-label="Prévia da DM">
                <span className="automation-bubble__label">DM</span>
                <p>{personalize(dmMessage)}</p>
                {buttons.length > 0 && (
                  <ul className="automation-bubble__buttons">
                    {buttons.map((button, index) => (
                      <li key={index}>{button.title || `Botão ${index + 1}`}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {!story && commentReply.trim() && (
              <div className="automation-bubble automation-bubble--public" aria-label="Prévia da resposta pública">
                <span className="automation-bubble__label">Resposta pública</span>
                <p>{personalize(commentReply)}</p>
              </div>
            )}
            {!(dmAllowed && dmMessage.trim()) && !(!story && commentReply.trim()) && <p className="field__hint">A prévia aparece quando você escrever a mensagem.</p>}
          </div>
        </aside>
      </div>

      {error && (
        <p className="auth-alert" role="alert">
          {error}
        </p>
      )}
      <div className="automation-builder__footer">
        <Link to={backTo} className="action-button">
          Cancelar
        </Link>
        <button type="submit" className="action-button action-button--primary" disabled={!canSave}>
          {saving ? 'Salvando…' : mode === 'edit' ? 'Salvar alterações' : 'Salvar pausada'}
        </button>
      </div>
      {mode === 'create' && <p className="field__hint">A automação é salva pausada. Para ela começar a responder, ative na página dela.</p>}
    </form>
  );
}
