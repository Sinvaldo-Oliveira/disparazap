import { CheckCircle2, KeyRound, LoaderCircle, Plus, QrCode, Smartphone, Trash2, Unplug } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import {
  INSTANCE_STATUS_LABELS,
  validatePhone,
  type InstanceStatus,
  type PlatformInstanceList,
  type WhatsAppInstance,
  type WhatsAppInstanceList,
} from '@disparazap/contracts';
import type { NavigationItem } from '../app/navigation';
import { useSession } from '../auth/AuthProvider';
import { Card } from '../components/Card';
import { PageHeader } from '../components/PageHeader';
import { StatusBadge, type BadgeTone } from '../components/StatusBadge';
import type { WhatsAppApi } from '../whatsapp/whatsapp-api';

const STATUS_TONES: Record<InstanceStatus, BadgeTone> = {
  created: 'neutral',
  connecting: 'development',
  connected: 'success',
  disconnected: 'danger',
  error: 'danger',
};

/** Tempo máximo esperando o celular ler o QR ou digitar o código */
const CONNECT_TIMEOUT_MS = 2 * 60_000;

export function formatPhone(digits: string | null): string {
  if (!digits) return '—';
  const br = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(digits);
  return br ? `+55 ${br[1]} ${br[2]}-${br[3]}` : `+${digits}`;
}

function StatusLabel({ status }: { status: InstanceStatus }) {
  return <StatusBadge tone={STATUS_TONES[status]}>{INSTANCE_STATUS_LABELS[status]}</StatusBadge>;
}

type Mode = 'qr' | 'code';

/** Painel de conexão: QR Code renovado sozinho ou código de pareamento, até o status virar "Conectado" */
function ConnectPanel({ api, instance, pollMs, onConnected, onClose }: { api: WhatsAppApi; instance: WhatsAppInstance; pollMs: number; onConnected: (i: WhatsAppInstance) => void; onClose: () => void }) {
  const [mode, setMode] = useState<Mode>('qr');
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [pairCode, setPairCode] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [expired, setExpired] = useState(false);
  const startedAt = useRef(0);

  const startWaiting = () => {
    startedAt.current = Date.now();
    setExpired(false);
    setWaiting(true);
  };

  const startQr = useCallback(async () => {
    setError(null);
    setPairCode(null);
    const result = await api.connect(instance.id);
    if (!result.ok) return setError(result.message);
    if (result.data.instance.status === 'connected') return onConnected(result.data.instance);
    setQrCode(result.data.qrCode);
    startWaiting();
  }, [api, instance.id, onConnected]);

  // Uma conexão por entrada na aba QR: sem a trava, o modo de desenvolvimento do React (StrictMode) chamava "conectar" duas vezes
  const qrStarted = useRef(false);
  useEffect(() => {
    if (mode !== 'qr') {
      qrStarted.current = false;
      return;
    }
    if (qrStarted.current) return;
    qrStarted.current = true;
    void startQr();
  }, [mode, startQr]);

  // Acompanha a conexão: no QR, renova a imagem; no código, só consulta o status
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(async () => {
      if (Date.now() - startedAt.current > CONNECT_TIMEOUT_MS) {
        setWaiting(false);
        setExpired(true);
        return;
      }
      if (mode === 'qr') {
        const result = await api.qr(instance.id);
        if (!result.ok) return;
        if (result.data.instance.status === 'connected') {
          setWaiting(false);
          onConnected(result.data.instance);
        } else if (result.data.qrCode) setQrCode(result.data.qrCode);
      } else {
        const result = await api.status(instance.id);
        if (result.ok && result.data.status === 'connected') {
          setWaiting(false);
          onConnected(result.data);
        }
      }
    }, pollMs);
    return () => clearInterval(timer);
  }, [waiting, mode, api, instance.id, pollMs, onConnected]);

  async function requestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const valid = validatePhone(phone);
    if (!valid.ok) return setError(valid.error);
    const result = await api.pair(instance.id, phone);
    if (!result.ok) return setError(result.message);
    setPairCode(result.data.code);
    startWaiting();
  }

  const switchMode = (next: Mode) => {
    setWaiting(false);
    setExpired(false);
    setError(null);
    setMode(next);
  };

  return (
    <section className="connect" aria-label={`Conectar ${instance.displayName}`}>
      <div className="connect__tabs" role="tablist" aria-label="Forma de conexão">
        <button type="button" role="tab" aria-selected={mode === 'qr'} className={`connect__tab${mode === 'qr' ? ' connect__tab--active' : ''}`} onClick={() => switchMode('qr')}>
          <QrCode aria-hidden="true" /> QR Code
        </button>
        <button type="button" role="tab" aria-selected={mode === 'code'} className={`connect__tab${mode === 'code' ? ' connect__tab--active' : ''}`} onClick={() => switchMode('code')}>
          <KeyRound aria-hidden="true" /> Código de pareamento
        </button>
      </div>

      {mode === 'qr' && (
        <div className="connect__body">
          <div className="connect__qr">
            {qrCode && !expired ? <img src={qrCode} alt="QR Code para conectar o WhatsApp" width={240} height={240} /> : <div className="connect__qr-placeholder">{expired ? 'QR Code expirado' : <LoaderCircle className="auth-status__icon--spin" aria-label="Gerando QR Code" />}</div>}
          </div>
          <ol className="connect__steps">
            <li>Abra o WhatsApp no celular.</li>
            <li>Toque em <strong>Configurações › Aparelhos conectados › Conectar aparelho</strong>.</li>
            <li>Aponte a câmera para este QR Code.</li>
          </ol>
        </div>
      )}

      {mode === 'code' && (
        <div className="connect__body connect__body--column">
          {!pairCode ? (
            <form className="connect__pair" onSubmit={requestCode} noValidate>
              <div className="field">
                <label className="field__label" htmlFor={`pair-${instance.id}`}>Número do WhatsApp (com DDI)</label>
                <input id={`pair-${instance.id}`} className="field__input" inputMode="tel" placeholder="5511988887777" value={phone} onChange={(e) => setPhone(e.target.value)} />
                <p className="field__hint">Só números brasileiros podem ir sem "+". Ex.: 55 + DDD + número.</p>
              </div>
              <button type="submit" className="action-button action-button--primary">Gerar código</button>
            </form>
          ) : (
            <>
              <p className="connect__code" aria-label="Código de pareamento">{pairCode.length === 8 ? `${pairCode.slice(0, 4)}-${pairCode.slice(4)}` : pairCode}</p>
              <ol className="connect__steps">
                <li>No celular, abra <strong>Configurações › Aparelhos conectados › Conectar aparelho</strong>.</li>
                <li>Toque em <strong>Conectar com número de telefone</strong> e digite o código acima.</li>
              </ol>
            </>
          )}
        </div>
      )}

      {waiting && <p className="connect__waiting" role="status"><LoaderCircle className="auth-status__icon--spin" aria-hidden="true" /> Aguardando a conexão no celular…</p>}
      {expired && <p className="auth-alert" role="alert">O tempo acabou. {mode === 'qr' ? 'Gere um novo QR Code.' : 'Peça um novo código.'}</p>}
      {error && <p className="auth-alert" role="alert">{error}</p>}

      <div className="integration__actions">
        {mode === 'qr' && expired && <button type="button" className="action-button" onClick={() => void startQr()}>Gerar novo QR Code</button>}
        {mode === 'code' && pairCode && expired && <button type="button" className="action-button" onClick={() => setPairCode(null)}>Pedir novo código</button>}
        <button type="button" className="action-button" onClick={onClose}>Fechar</button>
      </div>
    </section>
  );
}

function InstanceCard({ api, instance, canManage, pollMs, onChanged, onRemoved }: { api: WhatsAppApi; instance: WhatsAppInstance; canManage: boolean; pollMs: number; onChanged: (i: WhatsAppInstance) => void; onRemoved: (id: string) => void }) {
  const [connecting, setConnecting] = useState(false);
  const [confirm, setConfirm] = useState<'logout' | 'delete' | null>(null);
  const [typedName, setTypedName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleConnected = useCallback(
    (next: WhatsAppInstance) => {
      setConnecting(false);
      setNotice('WhatsApp conectado.');
      onChanged(next);
    },
    [onChanged],
  );

  async function logout() {
    setBusy(true);
    const result = await api.logout(instance.id);
    setBusy(false);
    setConfirm(null);
    if (!result.ok) return setError(result.message);
    setNotice('WhatsApp desconectado.');
    onChanged(result.data);
  }

  async function remove() {
    setBusy(true);
    const result = await api.remove(instance.id);
    setBusy(false);
    if (!result.ok) return setError(result.message);
    onRemoved(instance.id);
  }

  return (
    <li className="instance">
      <div className="instance__head">
        <Smartphone className="instance__icon" aria-hidden="true" />
        <div className="instance__info">
          <h3 className="instance__name">{instance.displayName}</h3>
          <p className="instance__meta">
            {formatPhone(instance.phone)}
            {instance.connectedAt && ` · conectado em ${new Date(instance.connectedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`}
          </p>
        </div>
        <StatusLabel status={instance.status} />
      </div>

      {notice && <p className="integration__success" role="status">{notice}</p>}
      {error && <p className="auth-alert" role="alert">{error}</p>}

      {canManage && !connecting && confirm === null && (
        <div className="integration__actions">
          {instance.status !== 'connected' && (
            <button type="button" className="action-button action-button--primary" onClick={() => { setNotice(null); setError(null); setConnecting(true); }}>
              <QrCode aria-hidden="true" /> Conectar
            </button>
          )}
          {instance.status === 'connected' && (
            <button type="button" className="action-button" onClick={() => setConfirm('logout')}>
              <Unplug aria-hidden="true" /> Desconectar
            </button>
          )}
          <button type="button" className="action-button action-button--danger" onClick={() => { setTypedName(''); setConfirm('delete'); }}>
            <Trash2 aria-hidden="true" /> Excluir
          </button>
        </div>
      )}

      {confirm === 'logout' && (
        <div className="instance__confirm" role="group" aria-label="Confirmar desconexão">
          <p>O número deixa de estar ligado a esta instância. Para usar de novo, será preciso conectar outra vez.</p>
          <div className="integration__actions">
            <button type="button" className="action-button action-button--danger" disabled={busy} onClick={() => void logout()}>Confirmar desconexão</button>
            <button type="button" className="action-button" onClick={() => setConfirm(null)}>Cancelar</button>
          </div>
        </div>
      )}

      {confirm === 'delete' && (
        <div className="instance__confirm" role="group" aria-label="Confirmar exclusão">
          <p>A instância será excluída do servidor de WhatsApp. Digite <strong>{instance.displayName}</strong> para confirmar.</p>
          <div className="field">
            <label className="field__label" htmlFor={`confirm-${instance.id}`}>Nome da instância</label>
            <input id={`confirm-${instance.id}`} className="field__input" value={typedName} onChange={(e) => setTypedName(e.target.value)} />
          </div>
          <div className="integration__actions">
            <button type="button" className="action-button action-button--danger" disabled={busy || typedName.trim() !== instance.displayName} onClick={() => void remove()}>Excluir definitivamente</button>
            <button type="button" className="action-button" onClick={() => setConfirm(null)}>Cancelar</button>
          </div>
        </div>
      )}

      {connecting && <ConnectPanel api={api} instance={instance} pollMs={pollMs} onConnected={handleConnected} onClose={() => setConnecting(false)} />}
    </li>
  );
}

function CompanyInstances({ api, pollMs, isSuperAdmin }: { api: WhatsAppApi; pollMs: number; isSuperAdmin: boolean }) {
  const [data, setData] = useState<WhatsAppInstanceList | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    api.list(controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (result.ok) setData(result.data);
      else setLoadError(result.message);
    });
    return () => controller.abort();
  }, [api]);

  const replace = useCallback((next: WhatsAppInstance) => setData((current) => current && { ...current, instances: current.instances.map((item) => (item.id === next.id ? next : item)) }), []);
  const removeOne = useCallback((id: string) => setData((current) => current && { ...current, instances: current.instances.filter((item) => item.id !== id) }), []);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    if (name.trim().length < 2) return setFormError('Dê um nome à instância (ex.: "Vendas").');
    setBusy(true);
    const result = await api.create(name.trim());
    setBusy(false);
    if (!result.ok) return setFormError(result.message);
    setData((current) => current && { ...current, instances: [...current.instances, result.data] });
    setCreating(false);
    setName('');
  }

  if (loadError) return <p className="auth-alert" role="alert">{loadError}</p>;
  if (!data) return <p className="integration__loading" role="status">Carregando as instâncias…</p>;

  const atLimit = data.instances.length >= data.limit;
  const ready = data.integration === 'ready';

  return (
    <Card title={`Instâncias da empresa (${data.instances.length} de ${data.limit})`} className="whatsapp">
      {!ready && (
        <div className="notice" role="note">
          <Unplug className="notice__icon" aria-hidden="true" />
          <p>
            <strong>A integração com o WhatsApp {data.integration === 'disabled' ? 'está desativada' : 'ainda não foi configurada'}.</strong>{' '}
            {isSuperAdmin ? (
              <>Configure-a em <Link to="/configuracoes" className="text-link">Configurações</Link>.</>
            ) : (
              'Fale com o administrador da plataforma.'
            )}
          </p>
        </div>
      )}

      {data.instances.length === 0 ? (
        <p className="card__text">Nenhuma instância ainda. {data.canManage ? 'Crie uma para conectar o número de WhatsApp da empresa.' : ''}</p>
      ) : (
        <ul className="instance-list">
          {data.instances.map((instance) => (
            <InstanceCard key={instance.id} api={api} instance={instance} canManage={data.canManage && ready} pollMs={pollMs} onChanged={replace} onRemoved={removeOne} />
          ))}
        </ul>
      )}

      {data.canManage && !creating && (
        <div className="integration__actions">
          <button type="button" className="action-button action-button--primary" disabled={!ready || atLimit} onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" /> Nova instância
          </button>
          {atLimit && <span className="field__hint">Sua empresa pode ter {data.limit} {data.limit === 1 ? 'instância' : 'instâncias'}.</span>}
        </div>
      )}
      {!data.canManage && <p className="field__hint">Só o dono e os administradores da empresa criam e conectam instâncias.</p>}

      {creating && (
        <form className="instance__new" onSubmit={handleCreate} noValidate>
          <div className="field">
            <label className="field__label" htmlFor="instance-name">Nome da instância</label>
            <input id="instance-name" className="field__input" placeholder="Ex.: Vendas" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          </div>
          {formError && <p className="auth-alert" role="alert">{formError}</p>}
          <div className="integration__actions">
            <button type="submit" className="action-button action-button--primary" disabled={busy}>{busy ? 'Criando…' : 'Criar instância'}</button>
            <button type="button" className="action-button" onClick={() => { setCreating(false); setFormError(null); }}>Cancelar</button>
          </div>
        </form>
      )}
    </Card>
  );
}

/** Super-Admin: todas as instâncias de todas as empresas, só leitura (decisão W5) */
function PlatformInstances({ api }: { api: WhatsAppApi }) {
  const [data, setData] = useState<PlatformInstanceList | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    api.listAll(controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (result.ok) setData(result.data);
      else setError(result.message);
    });
    return () => controller.abort();
  }, [api]);

  return (
    <Card title="Todas as instâncias (Super-Admin)">
      {error && <p className="auth-alert" role="alert">{error}</p>}
      {!data && !error && <p className="integration__loading" role="status">Carregando…</p>}
      {data && data.instances.length === 0 && <p className="card__text">Nenhuma empresa criou instâncias ainda.</p>}
      {data && data.instances.length > 0 && (
        <table className="table">
          <thead>
            <tr><th scope="col">Empresa</th><th scope="col">Instância</th><th scope="col">Número</th><th scope="col">Status</th></tr>
          </thead>
          <tbody>
            {data.instances.map((instance) => (
              <tr key={instance.id}>
                <td>{instance.organization.name}</td>
                <td>{instance.displayName}</td>
                <td>{formatPhone(instance.phone)}</td>
                <td><StatusLabel status={instance.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

export function WhatsAppPage({ item, api, pollMs = 3000 }: { item: NavigationItem; api: WhatsAppApi; pollMs?: number }) {
  const session = useSession();
  const isSuperAdmin = session.userType === 'super_admin';
  // Quem não tem empresa (Super-Admin da plataforma) só acompanha: o texto não pode falar em "sua empresa".
  const description = session.organization
    ? 'Conecte os números de WhatsApp da sua empresa por QR Code ou código de pareamento.'
    : 'Acompanhe as instâncias de WhatsApp de todas as empresas da plataforma.';

  return (
    <>
      <PageHeader title="WhatsApp" icon={item.icon} description={description} />
      {session.organization ? <CompanyInstances api={api} pollMs={pollMs} isSuperAdmin={isSuperAdmin} /> : null}
      {isSuperAdmin && <PlatformInstances api={api} />}
      <p className="field__hint whatsapp__note">
        <CheckCircle2 aria-hidden="true" /> Com o número conectado, envie mensagens em{' '}
        <Link className="text-link" to="/envio-de-mensagens">Envio de Mensagens</Link>.
      </p>
    </>
  );
}
