import cors from '@fastify/cors';
import type { FastifyInstance } from 'fastify';

// Cabeçalhos aplicados a toda resposta da API (JSON): sem cache, sem sniffing, sem embutir em frames
export function registerSecurityHeaders(app: FastifyInstance): void {
  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('cache-control', 'no-store');
    reply.header('x-request-id', String(request.id));
    return payload;
  });
}

/**
 * CORS por lista explícita de origens. Lista vazia (padrão) = nenhuma origem externa.
 * Requisições sem Origin (mesma origem, curl, health checks) não recebem cabeçalhos CORS.
 */
export async function registerCors(app: FastifyInstance, allowedOrigins: readonly string[]): Promise<void> {
  const allowed = new Set(allowedOrigins);
  await app.register(cors, {
    origin: (origin, callback) => callback(null, origin !== undefined && allowed.has(origin)),
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
    credentials: false,
    maxAge: 600,
  });
}
