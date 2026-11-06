import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodType } from 'zod';
import { zernioConnectInputSchema, zernioInboxAccessInputSchema, zernioKeyInputSchema, zernioReturnInputSchema } from '@disparazap/contracts';
import type { Auth } from '../auth/auth.ts';
import { canManage, registerMemberContext, sendProblem, type Member } from '../auth/member.ts';
import { registerOriginGuard } from '../plugins/origin-guard.ts';
import { RateLimiter } from '../security/rate-limiter.ts';
import {
  ZernioServiceError,
  completeZernioConnect,
  disconnectZernioAccount,
  getZernioStatus,
  listZernioAccounts,
  removeZernioKey,
  saveZernioKey,
  startZernioConnect,
  testInboxAccess,
  type ZernioContext,
} from '../zernio/zernio-service.ts';

export interface ZernioRoutesOptions {
  auth: Auth;
  context: ZernioContext;
  trustedOrigins: readonly string[];
}

/**
 * Integração da empresa com a própria conta Zernio, em /api/internal/integrations/zernio. Empresa e papel vêm da sessão.
 * A chave nunca volta ao navegador nem vai para o log; o log registra só a ação, a empresa e quem fez.
 */
export const zernioRoutes: FastifyPluginAsync<ZernioRoutesOptions> = async (app, { auth, context, trustedOrigins }) => {
  registerOriginGuard(app, trustedOrigins);
  registerMemberContext(app, { auth, db: context.db });

  // Por empresa: salvar a chave 10/min; conectar, voltar e desconectar 30/min
  const keyLimiter = new RateLimiter(10, 60_000);
  const actionLimiter = new RateLimiter(30, 60_000);
  const TOO_MANY = 'Muitas tentativas seguidas. Aguarde um pouco e tente de novo.';

  const handle =
    <T>(fn: (request: FastifyRequest, member: Member) => Promise<T>) =>
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        return await fn(request, request.member as Member);
      } catch (err) {
        if (err instanceof ZernioServiceError) {
          // O que a Zernio respondeu (códigos e números), para diagnosticar sem expor nada na tela
          if (err.diagnostic) request.log.warn({ acao: 'zernio.recusa', empresa: request.member?.organizationId, ...err.diagnostic }, 'a Zernio recusou o pedido');
          return sendProblem(request, reply, err.status, err.message);
        }
        throw err;
      }
    };
  const parseWith = <T>(schema: ZodType<T>, value: unknown): T => {
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw new ZernioServiceError(400, parsed.error.issues[0]?.message ?? 'Dados inválidos.');
    return parsed.data;
  };
  // Primeiro o papel, depois o limite: tentativas de quem não pode alterar não gastam o limite da empresa
  const limit = (limiter: RateLimiter, member: Member) => {
    if (!canManage(member)) throw new ZernioServiceError(403, 'Só o dono e os administradores da empresa configuram a Zernio e conectam redes.');
    if (!limiter.allow(member.organizationId)) throw new ZernioServiceError(429, TOO_MANY);
  };
  const audit = (request: FastifyRequest, member: Member, acao: string, extra: Record<string, unknown> = {}) =>
    request.log.info({ acao, ator: member.userId, empresa: member.organizationId, ...extra }, 'integração Zernio');

  app.get('/', handle((_request, member) => getZernioStatus(context, member)));

  app.put(
    '/key',
    handle(async (request, member) => {
      limit(keyLimiter, member);
      const { apiKey } = parseWith(zernioKeyInputSchema, request.body);
      const status = await saveZernioKey(context, member, apiKey);
      audit(request, member, 'zernio.chave.salva');
      return status;
    }),
  );

  app.delete('/key', async (request, reply) => {
    await handle(async (req, member) => {
      limit(keyLimiter, member);
      await removeZernioKey(context, member);
      audit(req, member, 'zernio.chave.removida');
      return null;
    })(request, reply);
    return reply.sent ? reply : reply.status(204).send();
  });

  app.get('/accounts', handle((_request, member) => listZernioAccounts(context, member)));

  // Teste de acesso à Inbox: administradores; confirmação obrigatória no corpo; o log leva só o resultado e o status
  app.post(
    '/inbox-access',
    handle(async (request, member) => {
      if (!canManage(member)) throw new ZernioServiceError(403, 'Só o dono e os administradores da empresa fazem o teste de acesso à Inbox.');
      limit(actionLimiter, member);
      parseWith(zernioInboxAccessInputSchema, request.body);
      const { result, upstreamStatus, shape } = await testInboxAccess(context, member);
      // forma: só os nomes das chaves de topo quando a resposta de sucesso não bateu com o esperado (nunca os valores)
      audit(request, member, 'zernio.inbox.teste', { resultado: result.outcome, status_servidor: upstreamStatus, ...(shape ? { forma: shape.join(',') } : {}) });
      return result;
    }),
  );

  app.post(
    '/connect',
    handle(async (request, member) => {
      limit(actionLimiter, member);
      const input = parseWith(zernioConnectInputSchema, request.body);
      const result = await startZernioConnect(context, member, input);
      audit(request, member, input.reconnectAccountId ? 'zernio.rede.reconexao_iniciada' : 'zernio.rede.conexao_iniciada', { rede: input.platform });
      return result;
    }),
  );

  app.post(
    '/connect/return',
    handle(async (request, member) => {
      limit(actionLimiter, member);
      const input = parseWith(zernioReturnInputSchema, request.body);
      const result = await completeZernioConnect(context, member, input);
      audit(request, member, result.ok ? 'zernio.rede.conectada' : 'zernio.rede.conexao_falhou', { rede: result.platform });
      return result;
    }),
  );

  app.delete('/accounts/:accountId', async (request, reply) => {
    await handle(async (req, member) => {
      limit(actionLimiter, member);
      const { accountId } = req.params as { accountId: string };
      if (!accountId || accountId.length > 100) throw new ZernioServiceError(404, 'Conta não encontrada nesta integração.');
      await disconnectZernioAccount(context, member, accountId);
      audit(req, member, 'zernio.rede.desconectada');
      return null;
    })(request, reply);
    return reply.sent ? reply : reply.status(204).send();
  });
};
