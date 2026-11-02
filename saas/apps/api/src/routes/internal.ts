import type { FastifyPluginAsync } from 'fastify';
import { PROBLEM_CONTENT_TYPE, signupRequestSchema, type SessionInfo } from '@disparazap/contracts';
import type { AppDatabase } from '@disparazap/db';
import type { Auth } from '../auth/auth.ts';
import { buildSessionInfo, type SessionUser } from '../auth/session-info.ts';
// SessionUser: o usuário da sessão do Better Auth inclui os campos extras (platformRole, origin)
import { SignupRejectedError, signupWithCompany } from '../auth/signup.ts';
import { problem } from '../plugins/error-handler.ts';
import { registerOriginGuard } from '../plugins/origin-guard.ts';
import { RateLimiter } from '../security/rate-limiter.ts';
import { authRequestHeaders } from './auth.ts';

export interface InternalRoutesOptions {
  auth: Auth;
  db: AppDatabase;
  signupEnabled: boolean;
  reservedEmail?: string | undefined;
  trustedOrigins: readonly string[];
}

/** Rotas do painel (mesma origem, sessão por cookie), montadas em /api/internal */
export const internalRoutes: FastifyPluginAsync<InternalRoutesOptions> = async (app, { auth, db, signupEnabled, reservedEmail, trustedOrigins }) => {
  registerOriginGuard(app, trustedOrigins);
  // Auditoria A3: o cadastro não tinha limite de tentativas (contas em massa, sondagem de e-mails)
  const signupLimiter = new RateLimiter(10, 10 * 60_000);

  // Cadastro público: conta + empresa, com sessão aberta em seguida
  app.post('/signup', async (request, reply) => {
    if (!signupEnabled) {
      return reply.status(403).type(PROBLEM_CONTENT_TYPE).send(problem(request, 403, 'O cadastro de novas contas está desativado.'));
    }
    if (!signupLimiter.allow(request.ip)) {
      return reply.status(429).type(PROBLEM_CONTENT_TYPE).send(problem(request, 429, 'Muitos cadastros seguidos deste endereço. Aguarde alguns minutos e tente de novo.'));
    }
    const parsed = signupRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      const detail = parsed.error.issues[0]?.message ?? 'Os dados enviados não passaram na validação.';
      return reply.status(400).type(PROBLEM_CONTENT_TYPE).send(problem(request, 400, detail));
    }

    try {
      const result = await signupWithCompany(parsed.data, { auth, db, reservedEmail, headers: authRequestHeaders(request) });
      const info: SessionInfo = await buildSessionInfo(db, result.user, result.organizationId);
      reply.header('set-cookie', result.setCookies);
      return reply.status(201).send(info);
    } catch (err) {
      if (err instanceof SignupRejectedError) {
        return reply.status(409).type(PROBLEM_CONTENT_TYPE).send(problem(request, 409, err.message));
      }
      throw err;
    }
  });

  // Quem está logado: tipo de usuário e empresa. 401 sem sessão válida.
  app.get('/me', async (request, reply) => {
    const session = await auth.api.getSession({ headers: authRequestHeaders(request) });
    if (!session) {
      return reply.status(401).type(PROBLEM_CONTENT_TYPE).send(problem(request, 401));
    }
    return buildSessionInfo(db, session.user as SessionUser, session.session.activeOrganizationId);
  });
};
