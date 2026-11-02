import { RefreshCw } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import type { FetchHealth, FetchReady } from '../app/health-client';
import { StatusBadge } from './StatusBadge';

type CheckState = 'checking' | 'online' | 'offline';

// Uma verificação real (API ou banco), com botão para repetir
function CheckRow({ label, check, onlineLabel, offlineHint }: { label: string; check: (signal: AbortSignal) => Promise<boolean>; onlineLabel: string; offlineHint: ReactNode }) {
  const [state, setState] = useState<CheckState>('checking');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState('checking');
    check(controller.signal).then(
      (ok) => setState(ok ? 'online' : 'offline'),
      () => {
        if (!controller.signal.aborted) setState('offline');
      },
    );
    return () => controller.abort();
  }, [check, attempt]);

  return (
    <div className="env-status__row">
      <dt>{label}</dt>
      <dd>
        {state === 'checking' && <StatusBadge tone="neutral">Verificando…</StatusBadge>}
        {state === 'online' && <StatusBadge tone="success">{onlineLabel}</StatusBadge>}
        {state === 'offline' && (
          <>
            <StatusBadge tone="danger">Indisponível</StatusBadge>
            <span className="env-status__hint">{offlineHint}</span>
          </>
        )}
        {state !== 'checking' && (
          <button type="button" className="icon-button" onClick={() => setAttempt((n) => n + 1)}>
            <RefreshCw aria-hidden="true" />
            Verificar {label === 'API' ? 'a API' : 'o banco'} novamente
          </button>
        )}
      </dd>
    </div>
  );
}

// API e banco são consultados de verdade; worker e filas descrevem fatos desta fase, sem simular status
export function EnvironmentStatus({ fetchHealth, fetchReady }: { fetchHealth: FetchHealth; fetchReady: FetchReady }) {
  const [checkApi] = useState(() => (signal: AbortSignal) => fetchHealth(signal).then(() => true));
  return (
    <dl className="env-status">
      <CheckRow label="API" check={checkApi} onlineLabel="Online" offlineHint={<>Inicie com <code>npm run dev:api</code></>} />
      <CheckRow label="Banco de dados" check={fetchReady} onlineLabel="Conectado" offlineHint="A API não conseguiu falar com o banco" />
      <div className="env-status__row">
        <dt>Worker</dt>
        <dd>
          <StatusBadge tone="neutral">Sem verificação</StatusBadge>
          <span className="env-status__hint">Processo separado (<code>npm run dev:worker</code>), sem filas nesta fase</span>
        </dd>
      </div>
      <div className="env-status__row">
        <dt>Filas</dt>
        <dd>
          <StatusBadge tone="neutral">Não conectadas</StatusBadge>
          <span className="env-status__hint">Previstas para a etapa 9</span>
        </dd>
      </div>
    </dl>
  );
}
