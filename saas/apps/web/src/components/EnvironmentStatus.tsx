import { RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { FetchHealth } from '../app/health-client';
import { StatusBadge } from './StatusBadge';

type ApiState = { kind: 'checking' } | { kind: 'online' } | { kind: 'offline' };

function ApiRow({ fetchHealth }: { fetchHealth: FetchHealth }) {
  const [state, setState] = useState<ApiState>({ kind: 'checking' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: 'checking' });
    fetchHealth(controller.signal).then(
      () => setState({ kind: 'online' }),
      () => {
        if (!controller.signal.aborted) setState({ kind: 'offline' });
      },
    );
    return () => controller.abort();
  }, [fetchHealth, attempt]);

  return (
    <div className="env-status__row">
      <dt>API</dt>
      <dd>
        {state.kind === 'checking' && <StatusBadge tone="neutral">Verificando…</StatusBadge>}
        {state.kind === 'online' && <StatusBadge tone="success">Online</StatusBadge>}
        {state.kind === 'offline' && (
          <>
            <StatusBadge tone="danger">Indisponível</StatusBadge>
            <span className="env-status__hint">Inicie com <code>npm run dev:api</code></span>
          </>
        )}
        {state.kind !== 'checking' && (
          <button type="button" className="icon-button" onClick={() => setAttempt((n) => n + 1)}>
            <RefreshCw aria-hidden="true" />
            Verificar novamente
          </button>
        )}
      </dd>
    </div>
  );
}

// Só a API é consultada de verdade; os demais itens descrevem fatos desta fase, sem simular status
export function EnvironmentStatus({ fetchHealth }: { fetchHealth: FetchHealth }) {
  return (
    <dl className="env-status">
      <ApiRow fetchHealth={fetchHealth} />
      <div className="env-status__row">
        <dt>Worker</dt>
        <dd>
          <StatusBadge tone="neutral">Sem verificação</StatusBadge>
          <span className="env-status__hint">Processo separado (<code>npm run dev:worker</code>), sem filas nesta fase</span>
        </dd>
      </div>
      <div className="env-status__row">
        <dt>Banco de dados</dt>
        <dd>
          <StatusBadge tone="neutral">Não conectado</StatusBadge>
          <span className="env-status__hint">Previsto para a Fase 5</span>
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
