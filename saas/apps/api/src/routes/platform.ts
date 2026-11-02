import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { PROBLEM_CONTENT_TYPE, evolutionSettingsInputSchema } from '@disparazap/contracts';
import type { AppDatabase } from '@disparazap/db';
import type { Auth } from '../auth/auth.ts';
import { userTypeOf, type SessionUser } from '../auth/session-info.ts';
import { SettingsError, getEvolutionSettings, saveEvolutionSettings, testEvolutionSettings, type ConnectionChecker } from '../platform/evolution-settings.ts';
import { problem } from '../plugins/error-handler.ts';
import { registerOriginGuard } from '../plugins/origin-guard.ts';
import type { Vault } from '../security/vault.ts';
import { listAllInstances, type WhatsAppContext } from '../whatsapp/whatsapp-service.ts';
import { authRequestHeaders } from './auth.ts';

export interface PlatformRoutesOptions {
  auth: Auth;
  db: AppDatabase;
  vault: Vault | null;
  trustedOrigins: readonly string[];
  /** Os testes trocam pelo simulador; em produção, a chamada real à Evolution Go */
  checkConnection?: ConnectionChecker;
  whatsapp: WhatsAppContext;
}

declare module 'fastify' {
  interface FastifyRequest {
    superAdminId?: string;
  }
}

function sendProblem(request: FastifyRequest, reply: FastifyReply, status: number, detail?: string) {
  return reply.status(status).type(PROBLEM_CONTENT_TYPE).send(problem(request, status, detail));
}

/** Configurações da plataforma, em /api/internal/platform: só o Super-Admin */
export const platformRoutes: FastifyPluginAsync<PlatformRoutesOptions> = async (app, options) => {
  const { auth, db, vault, trustedOrigins, checkConnection, whatsapp } = options;
  registerOriginGuard(app, trustedOrigins);

  app.addHook('preHandler', async (request, reply) => {
    const session = await auth.api.getSession({ headers: authRequestHeaders(request) });
    if (!session) return sendProblem(request, reply, 401);
    if (userTypeOf(session.user as SessionUser) !== 'super_admin') return sendProblem(request, reply, 403, 'Apenas o Super-Admin acessa as configurações da plataforma.');
    request.superAdminId = session.user.id;
  });

  app.get('/evolution', async () => getEvolutionSettings(db, vault));

  app.put('/evolution', async (request, reply) => {
    const parsed = evolutionSettingsInputSchema.safeParse(request.body);
    if (!parsed.success) return sendProblem(request, reply, 400, parsed.error.issues[0]?.message ?? 'Os dados enviados não passaram na validação.');
    try {
      const { settings, keyReplaced } = await saveEvolutionSettings(db, vault, parsed.data, request.superAdminId as string);
      // Registro da ação administrativa, sem a chave
      request.log.info({ acao: 'evolution.integracao.salva', ator: request.superAdminId, chaveSubstituida: keyReplaced, status: parsed.data.status }, 'integração global atualizada');
      return settings;
    } catch (err) {
      if (err instanceof SettingsError) return sendProblem(request, reply, err.status, err.message);
      throw err;
    }
  });

  // Decisão W5: o Super-Admin vê todas as instâncias de todas as empresas, só leitura
  app.get('/whatsapp/instances', async () => listAllInstances(whatsapp));

  app.post('/evolution/test', async (request, reply) => {
    try {
      const result = await testEvolutionSettings(db, vault, checkConnection);
      request.log.info({ acao: 'evolution.integracao.testada', ator: request.superAdminId, resultado: result.status }, 'conexão com a Evolution Go testada');
      return result;
    } catch (err) {
      if (err instanceof SettingsError) return sendProblem(request, reply, err.status, err.message);
      throw err;
    }
  });
};
