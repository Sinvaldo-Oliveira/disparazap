import type { FastifyPluginAsync } from 'fastify';

/**
 * API pública versionada, montada em /api/v1. Contrato estável: mudanças incompatíveis só em /api/v2.
 * Fase 4: nenhuma rota — tudo aqui responde 404 em RFC 9457. Rotas só entram com autenticação por API key.
 */
export const v1Routes: FastifyPluginAsync = async () => {};
