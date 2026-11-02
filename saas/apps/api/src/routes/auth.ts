import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { fromNodeHeaders } from 'better-auth/node';
import { AUTH_BASE_PATH } from '@disparazap/contracts';
import { CLIENT_IP_HEADER, type Auth } from '../auth/auth.ts';

export interface AuthRoutesOptions {
  auth: Auth;
  baseUrl: string;
}

/** Cabeçalhos da requisição para o Better Auth: IP vindo do socket, nunca de um cabeçalho enviado pelo cliente */
export function authRequestHeaders(request: FastifyRequest): Headers {
  const headers = fromNodeHeaders(request.headers);
  headers.delete('content-length');
  headers.delete('transfer-encoding');
  headers.delete(CLIENT_IP_HEADER);
  headers.set(CLIENT_IP_HEADER, request.ip);
  return headers;
}

// O token de sessão só existe no cookie HttpOnly: tirado do corpo das respostas, o JavaScript do painel não o vê
function withoutSessionToken(body: string, contentType: string | null): string {
  if (!contentType?.includes('application/json') || !body) return body;
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'token' in parsed) {
      const { token: _token, ...rest } = parsed as Record<string, unknown>;
      return JSON.stringify(rest);
    }
  } catch {
    // corpo não-JSON: segue como veio
  }
  return body;
}

/** Repassa /api/auth/* para o Better Auth (entrar, sair, sessão, organizações) */
export const authRoutes: FastifyPluginAsync<AuthRoutesOptions> = async (app, { auth, baseUrl }) => {
  app.route({
    method: ['GET', 'POST'],
    url: `${AUTH_BASE_PATH}/*`,
    handler: async (request, reply) => {
      const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
      const response = await auth.handler(
        new Request(new URL(request.url, baseUrl), {
          method: request.method,
          headers: authRequestHeaders(request),
          ...(hasBody ? { body: JSON.stringify(request.body ?? {}) } : {}),
        }),
      );

      reply.status(response.status);
      response.headers.forEach((value, key) => {
        if (key !== 'set-cookie' && key !== 'content-length') reply.header(key, value);
      });
      const cookies = response.headers.getSetCookie();
      if (cookies.length > 0) reply.header('set-cookie', cookies);
      const body = await response.text();
      return reply.send(withoutSessionToken(body, response.headers.get('content-type')));
    },
  });
};
