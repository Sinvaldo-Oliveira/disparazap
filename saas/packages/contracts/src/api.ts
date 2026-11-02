// Rotas estáveis conhecidas por API, painel e infraestrutura (health checks do Docker/Caddy)
export const HEALTH_LIVE_PATH = '/health/live';
// Pronto para atender: processo de pé e banco respondendo
export const HEALTH_READY_PATH = '/health/ready';

// API pública versionada (MyLinksss e outras integrações). Sem rotas na Fase 4.
export const API_V1_PREFIX = '/api/v1';
