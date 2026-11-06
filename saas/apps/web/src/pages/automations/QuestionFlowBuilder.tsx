import { ArrowLeft, Info } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { AUTOMATION_FLOW_LIMITS, AUTOMATION_QUESTION_LIMITS, questionFlowInputSchema, type AutomationAccount } from '@disparazap/contracts';
import type { AutomationsApi } from '../../automations/automations-api';

interface QuestionFlowBuilderProps {
  api: AutomationsApi;
  basePath: string;
}

const DEFAULT_QUESTION = 'Oi! Quer receber o material? Responda SIM que eu envio o link.';
const DEFAULT_REWARD = 'Aqui está o link que você pediu:';

/**
 * Construtor de "Comentário → perguntar antes" (PLANO_MODULO_AUTOMACOES, A6). Quem comenta a palavra-chave recebe uma
 * pergunta em texto; depois de responder, recebe o botão com o link. Só Instagram; nasce pausado (decisão A2).
 */
export function QuestionFlowBuilder({ api, basePath }: QuestionFlowBuilderProps) {
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState<AutomationAccount[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [accountId, setAccountId] = useState('');
  const [name, setName] = useState('');
  const [keywords, setKeywords] = useState('');
  const [question, setQuestion] = useState(DEFAULT_QUESTION);
  const [reward, setReward] = useState(DEFAULT_REWARD);
  const [buttonTitle, setButtonTitle] = useState('Quero o link');
  const [url, setUrl] = useState('');
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
  const keywordList = keywords
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    const parsed = questionFlowInputSchema.safeParse({ accountId: account?.id ?? '', name, keywords: keywordList, question, reward, buttonTitle, url });
    if (!parsed.success) return setProblem(parsed.error.issues[0]?.message ?? 'Confira os campos.');
    setProblem(null);
    setSaving(true);
    const result = await api.createQuestionFlow(parsed.data);
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
        <h2 className="card__title">Comentário → perguntar antes</h2>
        <p>Nenhuma conta do Instagram está conectada na Zernio. Conecte uma conta em Integrações para criar esta automação.</p>
        <Link to={basePath} relative="path" className="action-button">
          <ArrowLeft aria-hidden="true" /> Voltar para Automações
        </Link>
      </section>
    );
  }

  return (
    <form className="card automation-builder" aria-label="Construtor de pergunta antes do link" onSubmit={(event) => void save(event)} noValidate>
      <Link to={basePath} relative="path" className="automation-detail__back">
        <ArrowLeft aria-hidden="true" /> Voltar para Automações
      </Link>
      <h2 className="card__title">Novo comentário → perguntar antes</h2>
      <div className="notice" role="status">
        <Info className="notice__icon" aria-hidden="true" />
        <p>
          Quem comentar a palavra-chave recebe primeiro a pergunta em texto. O botão com o link só chega depois que a pessoa responde. O fluxo nasce pausado.
        </p>
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
            <span className="field__label">Palavras-chave</span>
            <input className="field__input" value={keywords} placeholder="guia, material" onChange={(event) => setKeywords(event.target.value)} />
            <span className="field__hint">Separe por vírgula, até {AUTOMATION_QUESTION_LIMITS.keywordsMax}. Use palavras específicas: uma palavra comum gera muitas conversas.</span>
          </label>
          <label className="field">
            <span className="field__label">Pergunta enviada primeiro</span>
            <textarea className="field__input" rows={3} value={question} maxLength={AUTOMATION_QUESTION_LIMITS.questionMax} onChange={(event) => setQuestion(event.target.value)} />
            <span className="field__hint">Só texto: o Instagram não aceita botões nessa primeira mensagem para quem não segue a conta.</span>
          </label>
          <label className="field">
            <span className="field__label">Mensagem que acompanha o link</span>
            <textarea className="field__input" rows={2} value={reward} maxLength={AUTOMATION_QUESTION_LIMITS.rewardMax} onChange={(event) => setReward(event.target.value)} />
          </label>
          <label className="field">
            <span className="field__label">Texto do botão</span>
            <input className="field__input" value={buttonTitle} maxLength={AUTOMATION_QUESTION_LIMITS.buttonTitleMax} onChange={(event) => setButtonTitle(event.target.value)} />
          </label>
          <label className="field">
            <span className="field__label">Link do botão</span>
            <input className="field__input" type="url" value={url} placeholder="https://" maxLength={AUTOMATION_QUESTION_LIMITS.urlMax} onChange={(event) => setUrl(event.target.value)} />
            <span className="field__hint">Precisa começar com https://.</span>
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

        <aside className="automation-builder__preview" aria-label="Prévia da conversa">
          <h3>Como a conversa acontece</h3>
          <p className="field__hint">Comentário com {keywordList.length > 0 ? `"${keywordList.join('", "')}"` : 'a palavra-chave'}:</p>
          <div className="automation-preview__bubble">{question || '…'}</div>
          <p className="field__hint">Depois da resposta da pessoa:</p>
          <div className="automation-preview__bubble">
            <p>{reward || '…'}</p>
            <span className="automation-preview__button">{buttonTitle || 'Botão'}</span>
          </div>
          <p className="field__hint">
            {account ? `Conta: ${account.name}. ` : ''}Se outra automação de comentário com a mesma palavra já existir, ela responde primeiro e esta não inicia. Sem resposta em 24 horas, a conversa termina.
          </p>
        </aside>
      </div>
    </form>
  );
}
