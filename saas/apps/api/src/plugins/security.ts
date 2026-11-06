import cors from '@fastify/cors';
import type { FastifyInstance } from 'fastify';

/**
 * Cabeçalhos aplicados a toda resposta: sem sniffing, sem embutir em frames e sem cache, a não ser que a rota
 * defina o próprio (arquivos do painel). Com hsts (produção, sempre em https), o navegador só volta por https.
 */
export function registerSecurityHeaders(app: FastifyInstance, { hsts = false }: { hsts?: boolean } = {}): void {
  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'no-referrer');
    if (!reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store');
    if (hsts) reply.header('strict-transport-security', 'max-age=31536000');
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
