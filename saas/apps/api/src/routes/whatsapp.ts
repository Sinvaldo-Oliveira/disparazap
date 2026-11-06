import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { createInstanceInputSchema, pairInputSchema } from '@disparazap/contracts';
import type { Auth } from '../auth/auth.ts';
import { registerMemberContext, sendProblem, type Member } from '../auth/member.ts';
import { registerOriginGuard } from '../plugins/origin-guard.ts';
import { RateLimiter } from '../security/rate-limiter.ts';
import {
  WhatsAppError,
  connectInstance,
  createInstance,
  currentQrCode,
  deleteInstance,
  listInstances,
  logoutInstance,
  pairInstance,
  refreshStatus,
  type WhatsAppContext,
} from '../whatsapp/whatsapp-service.ts';

export interface WhatsAppRoutesOptions {
  auth: Auth;
  context: WhatsAppContext;
  trustedOrigins: readonly string[];
}

/** Módulo WhatsApp, em /api/internal/whatsapp: empresa e papel vêm da sessão, nunca do navegador */
export const whatsappRoutes: FastifyPluginAsync<WhatsAppRoutesOptions> = async (app, { auth, context, trustedOrigins }) => {
  registerOriginGuard(app, trustedOrigins);

  // Limites por instância/empresa: o QR é consultado a cada 3 s enquanto aguarda (≈20/min)
  const qrLimiter = new RateLimiter(60, 60_000);
  const pairLimiter = new RateLimiter(5, 10 * 60_000);
  const createLimiter = new RateLimiter(10, 60 * 60_000);

  registerMemberContext(app, { auth, db: context.db });

  const handle =
    <T>(fn: (request: FastifyRequest, member: Member) => Promise<T>) =>
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        return await fn(request, request.member as Member);
      } catch (err) {
        if (err instanceof WhatsAppError) return sendProblem(request, reply, err.status, err.message);
        throw err;
      }
    };

  const param = (request: FastifyRequest) => (request.params as { id: string }).id;
  const tooMany = (request: FastifyRequest, reply: FastifyReply) => sendProblem(request, reply, 429, 'Muitas tentativas seguidas. Aguarde um pouco e tente de novo.');

  app.get('/instances', handle((_request, member) => listInstances(context, member)));

  app.post('/instances', async (request, reply) => {
    const result = await handle(async (req, member) => {
      const parsed = createInstanceInputSchema.safeParse(req.body);
      if (!parsed.success) throw new WhatsAppError(400, parsed.error.issues[0]?.message ?? 'Dados inválidos.');
      if (!createLimiter.allow(member.organizationId)) throw new WhatsAppError(429, 'Muitas instâncias criadas em pouco tempo. Aguarde e tente de novo.');
      const instance = await createInstance(context, member, parsed.data.displayName);
      req.log.info({ acao: 'whatsapp.instancia.criada', ator: member.userId, empresa: member.organizationId, instancia: instance.id }, 'instância criada');
      return instance;
    })(request, reply);
    return reply.sent ? reply : reply.status(201).send(result);
  });

  app.post('/instances/:id/connect', async (request, reply) => {
    if (!qrLimiter.allow(`${param(request)}`)) return tooMany(request, reply);
    return handle((req, member) => connectInstance(context, member, param(req)))(request, reply);
  });

  app.get('/instances/:id/qr', async (request, reply) => {
    if (!qrLimiter.allow(`${param(request)}`)) return tooMany(request, reply);
    return handle((req, member) => currentQrCode(context, member, param(req)))(request, reply);
  });

  app.post('/instances/:id/pair', async (request, reply) => {
    if (!pairLimiter.allow(`${param(request)}`)) return tooMany(request, reply);
    return handle(async (req, member) => {
      const parsed = pairInputSchema.safeParse(req.body);
      if (!parsed.success) throw new WhatsAppError(400, parsed.error.issues[0]?.message ?? 'Dados inválidos.');
      return pairInstance(context, member, param(req), parsed.data.phone);
    })(request, reply);
  });

  app.get('/instances/:id/status', handle((request, member) => refreshStatus(context, member, param(request))));

  app.post(
    '/instances/:id/logout',
    handle(async (request, member) => {
      const instance = await logoutInstance(context, member, param(request));
      request.log.info({ acao: 'whatsapp.instancia.desconectada', ator: member.userId, instancia: instance.id }, 'instância desconectada');
      return instance;
    }),
  );

  app.delete('/instances/:id', async (request, reply) => {
    await handle(async (req, member) => {
      try {
        const result = await deleteInstance(context, member, param(req));
        req.log.info({ acao: 'whatsapp.instancia.excluida', ator: member.userId, instancia: param(req), ja_removida_no_servidor: result.goneOnServer, status_servidor: result.upstreamStatus }, 'instância excluída');
      } catch (err) {
        // Diagnóstico: o status da Evolution vai só para o log (a tela recebe a mensagem fixa)
        if (err instanceof WhatsAppError && err.upstreamStatus !== null) {
          req.log.warn({ acao: 'whatsapp.exclusao.recusada', ator: member.userId, instancia: param(req), status_servidor: err.upstreamStatus }, 'o servidor de WhatsApp recusou a exclusão');
        }
        throw err;
      }
      return null;
    })(request, reply);
    return reply.sent ? reply : reply.status(204).send();
  });
};
