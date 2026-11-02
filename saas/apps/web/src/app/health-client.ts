import { HEALTH_LIVE_PATH, HEALTH_READY_PATH, healthLiveSchema, type HealthLive } from '@disparazap/contracts';

export type FetchHealth = (signal: AbortSignal) => Promise<HealthLive>;
/** true quando a API responde que o banco está pronto */
export type FetchReady = (signal: AbortSignal) => Promise<boolean>;

// Consulta real à API, na mesma origem (em desenvolvimento, o Vite repassa para a API local)
export const fetchHealth: FetchHealth = async (signal) => {
  const response = await fetch(HEALTH_LIVE_PATH, { signal, headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return healthLiveSchema.parse(await response.json());
};

export const fetchReady: FetchReady = async (signal) => {
  const response = await fetch(HEALTH_READY_PATH, { signal, headers: { accept: 'application/json' } });
  return response.ok;
};
