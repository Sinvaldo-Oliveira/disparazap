import type { FastifyInstance } from 'fastify';
import { PROBLEM_CONTENT_TYPE } from '@disparazap/contracts';
import { problem } from './error-handler.ts';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Proteção contra pedidos vindos de outros sites (CSRF) nas rotas do painel: todo pedido que altera dados
 * precisa trazer o cabeçalho Origin de uma origem confiável. Vale para o escopo onde o plugin é registrado.
 */
export function registerOriginGuard(app: FastifyInstance, trustedOrigins: readonly string[]): void {
  const trusted = new Set(trustedOrigins);
  app.addHook('onRequest', async (request, reply) => {
    if (!UNSAFE_METHODS.has(request.method)) return;
    const origin = request.headers.origin;
    if (typeof origin === 'string' && trusted.has(origin)) return;
    return reply.status(403).type(PROBLEM_CONTENT_TYPE).send(problem(request, 403, 'Pedido recusado pela verificação de origem.'));
  });
}
