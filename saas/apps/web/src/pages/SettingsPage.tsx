import { CheckCircle2, KeyRound, PlugZap, Save, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import {
  EVOLUTION_PRIMARY_SERVER_NAME,
  evolutionUrlProblem,
  type ConnectionCheckStatus,
  type EvolutionSettings,
  type EvolutionTestResult,
} from '@disparazap/contracts';
import type { NavigationItem } from '../app/navigation';
import { useSession } from '../auth/AuthProvider';
import { Card } from '../components/Card';
import { PageHeader } from '../components/PageHeader';
import { PasswordField } from '../components/PasswordField';
import { StatusBadge, type BadgeTone } from '../components/StatusBadge';
import type { PlatformApi } from '../platform/platform-api';
import { ModulePage } from './ModulePage';

const CHECK_LABELS: Record<ConnectionCheckStatus, { label: string; tone: BadgeTone }> = {
  ok: { label: 'Conectado', tone: 'success' },
  unauthorized: { label: 'Chave recusada', tone: 'danger' },
  unreachable: { label: 'Sem conexão', tone: 'danger' },
  invalid_response: { label: 'Resposta inesperada', tone: 'danger' },
  error: { label: 'Erro no servidor', tone: 'danger' },
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

type Notice = { tone: 'success' | 'error'; text: string } | null;

function ConnectionStatus({ settings }: { settings: EvolutionSettings }) {
  const server = settings.server;
  if (!server) return <StatusBadge tone="neutral">Não configurado</StatusBadge>;
  if (server.status === 'disabled') return <StatusBadge tone="neutral">Desativado</StatusBadge>;
  const check = server.lastCheck;
  if (!check.status || !check.at) return <StatusBadge tone="development">Ainda não testado</StatusBadge>;
  const { label, tone } = CHECK_LABELS[check.status];
  return (
    <span className="integration__status">
      <StatusBadge tone={tone}>{label}</StatusBadge>
      <span className="integration__status-text">
        Último teste em {formatDate(check.at)}
        {check.detail ? ` · ${check.detail}` : ''}
      </span>
    </span>
  );
}

function EvolutionIntegrationCard({ api }: { api: PlatformApi }) {
  const [settings, setSettings] = useState<EvolutionSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState(EVOLUTION_PRIMARY_SERVER_NAME);
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [active, setActive] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [testResult, setTestResult] = useState<EvolutionTestResult | null>(null);

  function apply(next: EvolutionSettings) {
    setSettings(next);
    if (next.server) {
      setName(next.server.name);
      setBaseUrl(next.server.baseUrl);
      setActive(next.server.status === 'active');
    }
    setApiKey('');
    setDirty(false);
  }

  useEffect(() => {
    const controller = new AbortController();
    api.getEvolutionSettings(controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (result.ok) apply(result.data);
      else setLoadError(result.message);
    });
    return () => controller.abort();
  }, [api]);

  const change = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value);
    setDirty(true);
    setNotice(null);
  };

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    setTestResult(null);
    const urlProblem = evolutionUrlProblem(baseUrl);
    if (name.trim().length < 2) return setNotice({ tone: 'error', text: 'Dê um nome ao servidor.' });
    if (urlProblem) return setNotice({ tone: 'error', text: urlProblem });
    if (!settings?.server?.apiKey.configured && !apiKey.trim()) {
      return setNotice({ tone: 'error', text: 'Informe a chave global da API (GLOBAL_API_KEY da Evolution Go).' });
    }
    setBusy('save');
    const result = await api.saveEvolutionSettings({ name: name.trim(), baseUrl: baseUrl.trim(), status: active ? 'active' : 'disabled', apiKey: apiKey.trim() });
    setBusy(null);
    if (result.ok) {
      apply(result.data);
      setNotice({ tone: 'success', text: 'Integração salva. A chave fica guardada cifrada e não é exibida de novo.' });
    } else {
      setNotice({ tone: 'error', text: result.message });
    }
  }

  async function handleTest() {
    setNotice(null);
    setBusy('test');
    const result = await api.testEvolution();
    setBusy(null);
    if (!result.ok) return setNotice({ tone: 'error', text: result.message });
    setTestResult(result.data);
    const refreshed = await api.getEvolutionSettings();
    if (refreshed.ok) setSettings(refreshed.data);
  }

  if (loadError) return <p className="auth-alert" role="alert">{loadError}</p>;
  if (!settings) return <p className="integration__loading" role="status">Carregando a configuração…</p>;

  const keyConfigured = settings.server?.apiKey.configured ?? false;
  const canTest = Boolean(settings.server && keyConfigured) && !dirty && busy === null;

  return (
    <Card title="Integração global · Evolution Go" className="integration">
      <p className="card__text">
        Conexão com a API da Evolution Go usada pelas contas das empresas (Admin-Empresa e Admin-MyLinksss) para criar as
        instâncias e conectar os números de WhatsApp. A chave global fica só no servidor: as empresas nunca a veem.
      </p>

      <div className="integration__row">
        <span className="integration__label">Situação</span>
        <ConnectionStatus settings={settings} />
      </div>

      {!settings.vaultReady && (
        <div className="notice" role="alert">
          <TriangleAlert className="notice__icon" aria-hidden="true" />
          <p>
            <strong>Cofre de credenciais não configurado.</strong> Defina <code>SECRETS_MASTER_KEY</code> no <code>saas/.env</code>
            e reinicie a API. Sem ele, a chave global não pode ser salva.
          </p>
        </div>
      )}

      {/* noValidate: as mensagens são as nossas (mais claras que as nativas); "required" continua para leitores de tela */}
      <form className="integration__form" onSubmit={handleSave} noValidate>
        <div className="integration__grid">
          <div className="field">
            <label className="field__label" htmlFor="evolution-name">Nome do servidor</label>
            <input id="evolution-name" className="field__input" value={name} onChange={(e) => change(setName)(e.target.value)} required maxLength={80} />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="evolution-url">URL da API</label>
            <input
              id="evolution-url"
              className="field__input"
              type="url"
              inputMode="url"
              placeholder="https://evolution.suaempresa.com.br"
              value={baseUrl}
              onChange={(e) => change(setBaseUrl)(e.target.value)}
              aria-describedby="evolution-url-dica"
              required
            />
            <p id="evolution-url-dica" className="field__hint">Endereço base da API, com https://. O mesmo valor de EVOLUTION_URL.</p>
          </div>
        </div>

        <PasswordField
          label="Chave global da API (GLOBAL_API_KEY)"
          value={apiKey}
          onChange={change(setApiKey)}
          autoComplete="new-password"
          required={!keyConfigured}
          hint={
            keyConfigured
              ? `Chave guardada, termina em ••••${settings.server?.apiKey.last4 ?? ''}. Deixe em branco para manter; preencha só para trocar.`
              : 'A chave definida no servidor da Evolution Go. Ela é guardada cifrada e nunca mais é exibida.'
          }
        />

        <label className="checkbox integration__toggle">
          <input type="checkbox" checked={active} onChange={(e) => change(setActive)(e.target.checked)} />
          <span>Integração ativa (as empresas podem usá-la)</span>
        </label>

        {notice && (
          <p className={notice.tone === 'success' ? 'integration__success' : 'auth-alert'} role={notice.tone === 'success' ? 'status' : 'alert'}>
            {notice.text}
          </p>
        )}

        {testResult && (
          <div className={`integration__result integration__result--${testResult.status === 'ok' ? 'ok' : 'fail'}`} role="status">
            {testResult.status === 'ok' ? <CheckCircle2 aria-hidden="true" /> : <TriangleAlert aria-hidden="true" />}
            <span>
              {testResult.detail}
              {testResult.instances !== null && ` Instâncias no servidor: ${testResult.instances}.`}
            </span>
          </div>
        )}

        <div className="integration__actions">
          <button type="submit" className="action-button action-button--primary" disabled={busy !== null}>
            <Save aria-hidden="true" />
            {busy === 'save' ? 'Salvando…' : 'Salvar integração'}
          </button>
          <button type="button" className="action-button" onClick={handleTest} disabled={!canTest}>
            <PlugZap aria-hidden="true" />
            {busy === 'test' ? 'Testando…' : 'Testar conexão'}
          </button>
          {dirty && settings.server && <span className="field__hint">Salve as alterações antes de testar.</span>}
        </div>
      </form>

      <ul className="integration__facts">
        <li><ShieldCheck aria-hidden="true" /> A chave é cifrada (AES-256-GCM) e só o servidor consegue lê-la.</li>
        <li><KeyRound aria-hidden="true" /> O teste só consulta a lista de instâncias: não cria nem altera nada na Evolution Go.</li>
      </ul>
    </Card>
  );
}

/** Configurações: o Super-Admin administra a plataforma; para os demais, as configurações da empresa ainda estão em desenvolvimento */
export function SettingsPage({ item, platformApi }: { item: NavigationItem; platformApi: PlatformApi }) {
  const session = useSession();
  if (session.userType !== 'super_admin') return <ModulePage item={item} />;

  return (
    <>
      <PageHeader title="Configurações" icon={item.icon} description="Configurações da plataforma DisparaZap. Só o Super-Admin vê esta tela." />
      <EvolutionIntegrationCard api={platformApi} />
      <Card title="Próxima etapa">
        <p className="card__text">
          Com a integração ativa e testada, o módulo <strong>WhatsApp</strong> (em desenvolvimento) vai permitir que cada empresa
          crie as próprias instâncias e conecte seus números pelo QR Code ou pelo código de pareamento.
        </p>
      </Card>
    </>
  );
}
