import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { Auth } from '../auth/auth.ts';
import { registerMemberContext, sendProblem, type Member } from '../auth/member.ts';
import {
  automationActivity,
  automationDetail,
  automationsOverview,
  createAutomation,
  createFlow,
  createQuestionFlow,
  deleteAutomation,
  deleteFlow,
  flowQr,
  flowsList,
  setAutomationState,
  setFlowState,
  updateAutomation,
} from '../automations/automations-service.ts';
import { registerOriginGuard } from '../plugins/origin-guard.ts';
import { RateLimiter } from '../security/rate-limiter.ts';
import { ZernioServiceError, type ZernioContext } from '../zernio/zernio-service.ts';

export interface AutomationsRoutesOptions {
  auth: Auth;
  context: ZernioContext;
  trustedOrigins: readonly string[];
  /** AUTOMATIONS_WRITE_ENABLED (padrão false): sem ela, nada é criado, alterado, ativado ou excluído na Zernio */
  writeEnabled: boolean;
}

/**
 * Automações de redes pela Zernio, em /api/internal/automations (PLANO_MODULO_AUTOMACOES: A1 consulta, A2 escrita).
 * Empresa e papel vêm da sessão; a chave da Zernio nunca sai da API; o log leva só ids, contas e contagens.
 */
export const automationsRoutes: FastifyPluginAsync<AutomationsRoutesOptions> = async (app, { auth, context, trustedOrigins, writeEnabled }) => {
  registerOriginGuard(app, trustedOrigins);
  registerMemberContext(app, { auth, db: context.db });

  // Por empresa: 120 leituras/min (atividade a cada 15 s na A4; decisão A9) e 30 alterações/min
  const readLimiter = new RateLimiter(120, 60_000);
  const writeLimiter = new RateLimiter(30, 60_000);
  const TOO_MANY = 'Muitas ações seguidas. Aguarde um pouco e tente de novo.';

  const handle =
    <T>(fn: (request: FastifyRequest, member: Member) => Promise<T>) =>
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        return await fn(request, request.member as Member);
      } catch (err) {
        if (err instanceof ZernioServiceError) {
          if (err.diagnostic) request.log.warn({ acao: 'automacoes.recusa', empresa: request.member?.organizationId, ...err.diagnostic }, 'a Zernio recusou o pedido');
          return sendProblem(request, reply, err.status, err.message);
        }
        throw err;
      }
    };
  const limit = (limiter: RateLimiter, member: Member) => {
    if (!limiter.allow(member.organizationId)) throw new ZernioServiceError(429, TOO_MANY);
  };
  const audit = (request: FastifyRequest, member: Member, acao: string, extra: Record<string, unknown> = {}) =>
    request.log.info({ acao, ator: member.userId, empresa: member.organizationId, ...extra }, 'automações');
  const id = (request: FastifyRequest) => (request.params as { id: string }).id;

  app.get(
    '/overview',
    handle(async (request, member) => {
      limit(readLimiter, member);
      const result = await automationsOverview(context, member, writeEnabled);
      audit(request, member, 'automacoes.lista', { quantidade: result.automations.length, contas: result.accounts.length });
      return result;
    }),
  );

  app.get(
    '/comment/:id',
    handle(async (request, member) => {
      limit(readLimiter, member);
      const result = await automationDetail(context, member, id(request), writeEnabled);
      audit(request, member, 'automacoes.detalhe', { automacao: result.automation.id });
      return result;
    }),
  );

  app.post('/comment', async (request, reply) => {
    const result = await handle(async (req, member) => {
      limit(writeLimiter, member);
      const created = await createAutomation(context, member, req.body, writeEnabled);
      audit(req, member, 'automacoes.criada', { automacao: created.automation.id, conta: created.automation.accountId, rede: created.automation.platform, ativa: created.automation.isActive });
      return created;
    })(request, reply);
    return reply.sent ? reply : reply.status(201).send(result);
  });

  app.put(
    '/comment/:id',
    handle(async (request, member) => {
      limit(writeLimiter, member);
      const updated = await updateAutomation(context, member, id(request), request.body, writeEnabled);
      audit(request, member, 'automacoes.alterada', { automacao: updated.automation.id });
      return updated;
    }),
  );

  app.post(
    '/comment/:id/state',
    handle(async (request, member) => {
      limit(writeLimiter, member);
      const updated = await setAutomationState(context, member, id(request), request.body, writeEnabled);
      audit(request, member, updated.automation.isActive ? 'automacoes.ativada' : 'automacoes.pausada', { automacao: updated.automation.id });
      return updated;
    }),
  );

  app.delete('/comment/:id', async (request, reply) => {
    await handle(async (req, member) => {
      limit(writeLimiter, member);
      const removed = await deleteAutomation(context, member, id(req), writeEnabled);
      audit(req, member, 'automacoes.excluida', { automacao: removed.id });
      return removed;
    })(request, reply);
    return reply.sent ? reply : reply.status(204).send();
  });

  // ----- Atividade (A4): registros da automação; comentários que não casaram só para dono e administradores -----
  app.get(
    '/comment/:id/activity',
    handle(async (request, member) => {
      limit(readLimiter, member);
      const result = await automationActivity(context, member, id(request));
      audit(request, member, 'automacoes.atividade', { automacao: id(request), registros: result.entries.length });
      return result;
    }),
  );

  // ----- Link ou QR → conversa (A5) -----

  app.get(
    '/flows',
    handle(async (request, member) => {
      limit(readLimiter, member);
      const result = await flowsList(context, member, writeEnabled);
      audit(request, member, 'automacoes.fluxos', { quantidade: result.flows.length });
      return result;
    }),
  );

  app.get(
    '/flows/:id/qr',
    handle(async (request, member) => {
      limit(readLimiter, member);
      const result = await flowQr(context, member, id(request));
      audit(request, member, 'automacoes.fluxo_qr', { fluxo: id(request) });
      return result;
    }),
  );

  // Comentário → perguntar antes (A6): mesma trava, papéis e regras de conta da criação de link
  app.post('/flows/question', async (request, reply) => {
    const result = await handle(async (req, member) => {
      limit(writeLimiter, member);
      const created = await createQuestionFlow(context, member, req.body, writeEnabled);
      audit(req, member, 'automacoes.pergunta_criada', { fluxo: created.id, conta: created.accountId, ativo: created.isActive });
      return created;
    })(request, reply);
    return reply.sent ? reply : reply.status(201).send(result);
  });

  app.post('/flows', async (request, reply) => {
    const result = await handle(async (req, member) => {
      limit(writeLimiter, member);
      const created = await createFlow(context, member, req.body, writeEnabled);
      audit(req, member, 'automacoes.fluxo_criado', { fluxo: created.id, conta: created.accountId, ativo: created.isActive });
      return created;
    })(request, reply);
    return reply.sent ? reply : reply.status(201).send(result);
  });

  app.post(
    '/flows/:id/state',
    handle(async (request, member) => {
      limit(writeLimiter, member);
      const updated = await setFlowState(context, member, id(request), request.body, writeEnabled);
      audit(request, member, updated.isActive ? 'automacoes.fluxo_ativado' : 'automacoes.fluxo_pausado', { fluxo: updated.id });
      return updated;
    }),
  );

  app.delete('/flows/:id', async (request, reply) => {
    await handle(async (req, member) => {
      limit(writeLimiter, member);
      const removed = await deleteFlow(context, member, id(req), writeEnabled);
      audit(req, member, 'automacoes.fluxo_excluido', { fluxo: removed.id });
      return removed;
    })(request, reply);
    return reply.sent ? reply : reply.status(204).send();
  });
};
