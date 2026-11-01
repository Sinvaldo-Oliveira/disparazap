import { HEALTH_LIVE_PATH, healthLiveSchema, type HealthLive } from '@disparazap/contracts';

export type FetchHealth = (signal: AbortSignal) => Promise<HealthLive>;

// Consulta real à API, na mesma origem (em desenvolvimento, o Vite repassa para a API local)
export const fetchHealth: FetchHealth = async (signal) => {
  const response = await fetch(HEALTH_LIVE_PATH, { signal, headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return healthLiveSchema.parse(await response.json());
};
