import { ArrowLeft, Info } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { AUTOMATION_FLOW_LIMITS, flowInputSchema, type AutomationAccount } from '@disparazap/contracts';
import type { AutomationsApi } from '../../automations/automations-api';

interface FlowBuilderProps {
  api: AutomationsApi;
  basePath: string;
}

const DEFAULT_MESSAGE = 'Oi! Obrigado por chegar pelo nosso link. Em que podemos ajudar?';

/**
 * Construtor de "Link → conversa" (PLANO_MODULO_AUTOMACOES, A5): um link ig.me/m/<conta>?ref=<código> abre a conversa
 * com uma mensagem pronta e marca quem entrou. Só Instagram nesta etapa; o fluxo nasce pausado (decisão A2).
 */
export function FlowBuilder({ api, basePath }: FlowBuilderProps) {
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState<AutomationAccount[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [accountId, setAccountId] = useState('');
  const [name, setName] = useState('');
  const [ref, setRef] = useState('');
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [tag, setTag] = useState('veio-do-link');
  const [cooldown, setCooldown] = useState('24');
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void api.overview(controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (!result.ok) return setLoadError(result.message);
      setAccounts(result.data.accounts);
    });
    return () => controller.abort();
  }, [api]);

  const instagram = useMemo(() => (accounts ?? []).filter((item) => item.platform === 'instagram'), [accounts]);
  const account = instagram.find((item) => item.id === accountId) ?? instagram[0] ?? null;
  // A prévia mostra o formato do link; o endereço real sai na lista depois de criar, com a conta da Zernio
  const username = account ? account.name.replace(/^@/, '') : 'sua-conta';
  const linkPreview = `ig.me/m/${username}?ref=${ref || 'codigo'}`;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    const parsed = flowInputSchema.safeParse({ accountId: account?.id ?? '', name, ref, message, tag, cooldownHours: Number(cooldown) });
    if (!parsed.success) return setProblem(parsed.error.issues[0]?.message ?? 'Confira os campos.');
    setProblem(null);
    setSaving(true);
    const result = await api.createFlow(parsed.data);
    setSaving(false);
    if (!result.ok) return setProblem(result.message);
    navigate(basePath);
  }

  if (loadError) {
    return (
      <section className="card automation-builder">
        <p className="auth-alert" role="alert">
          {loadError}
        </p>
      </section>
    );
  }
  if (accounts === null) {
    return (
      <section className="card automation-builder">
        <p className="integration__loading" role="status">
          Carregando as contas…
        </p>
      </section>
    );
  }
  if (instagram.length === 0) {
    return (
      <section className="card automation-builder">
        <h2 className="card__title">Link → conversa</h2>
        <p>Nenhuma conta do Instagram está conectada na Zernio. Conecte uma conta em Integrações para criar um link.</p>
        <Link to={basePath} relative="path" className="action-button">
          <ArrowLeft aria-hidden="true" /> Voltar para Automações
        </Link>
      </section>
    );
  }

  return (
    <form className="card automation-builder" aria-label="Construtor de link" onSubmit={(event) => void save(event)} noValidate>
      <Link to={basePath} relative="path" className="automation-detail__back">
        <ArrowLeft aria-hidden="true" /> Voltar para Automações
      </Link>
      <h2 className="card__title">Novo link → conversa</h2>
      <div className="notice" role="status">
        <Info className="notice__icon" aria-hidden="true" />
        <p>O fluxo nasce pausado. Ative-o na lista de links quando o link estiver pronto para divulgar.</p>
      </div>

      <div className="automation-builder__layout">
        <div className="automation-builder__form">
          <label className="field">
            <span className="field__label">Conta (Instagram)</span>
            <select className="field__input" value={account?.id ?? ''} onChange={(event) => setAccountId(event.target.value)}>
              {instagram.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">Nome do fluxo</span>
            <input className="field__input" value={name} maxLength={AUTOMATION_FLOW_LIMITS.nameMax} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="field">
            <span className="field__label">Código do link</span>
            <input className="field__input" value={ref} maxLength={AUTOMATION_FLOW_LIMITS.refMax} placeholder="promo-natal" onChange={(event) => setRef(event.target.value.toLowerCase())} />
            <span className="field__hint">Vai no fim do link. Use letras minúsculas, números e hífens, sem espaços.</span>
          </label>
          <label className="field">
            <span className="field__label">Mensagem de abertura</span>
            <textarea className="field__input" rows={3} value={message} maxLength={AUTOMATION_FLOW_LIMITS.messageMax} onChange={(event) => setMessage(event.target.value)} />
          </label>
          <label className="field">
            <span className="field__label">Etiqueta de quem entrou</span>
            <input className="field__input" value={tag} maxLength={AUTOMATION_FLOW_LIMITS.tagMax} onChange={(event) => setTag(event.target.value)} />
            <span className="field__hint">Marca a pessoa na Zernio para você encontrá-la depois.</span>
          </label>
          <label className="field">
            <span className="field__label">Repetir para a mesma pessoa depois de (horas)</span>
            <input className="field__input" type="number" min={AUTOMATION_FLOW_LIMITS.cooldownHoursMin} max={AUTOMATION_FLOW_LIMITS.cooldownHoursMax} value={cooldown} onChange={(event) => setCooldown(event.target.value)} />
            <span className="field__hint">Padrão de 24 horas. Dentro desse intervalo, a mesma pessoa não recebe a mensagem de novo.</span>
          </label>

          {problem && (
            <p className="auth-alert" role="alert">
              {problem}
            </p>
          )}
          <div className="automation-builder__actions">
            <button type="submit" className="action-button action-button--primary" disabled={saving}>
              {saving ? 'Criando…' : 'Criar pausado'}
            </button>
            <Link to={basePath} relative="path" className="action-button">
              Cancelar
            </Link>
          </div>
        </div>

        <aside className="automation-builder__preview" aria-label="Prévia do link">
          <h3>Link para divulgar</h3>
          <code className="automation-builder__link">{linkPreview}</code>
          <p className="field__hint">Quem toca no link abre a conversa com a mensagem ao lado. O link completo e o botão de copiar aparecem na lista depois de criar.</p>
          <div className="automation-preview__bubble">{message || '…'}</div>
          <p className="field__hint">O Instagram nem sempre repassa o código do link. Quando não repassa, o fluxo não dispara. A alternativa "envie MENU" e o QR code ainda não estão nesta tela.</p>
        </aside>
      </div>
    </form>
  );
}
