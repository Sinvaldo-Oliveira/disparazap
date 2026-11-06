import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { socialAnalyticsQuerySchema } from '@disparazap/contracts';
import type { Auth } from '../auth/auth.ts';
import { registerMemberContext, sendProblem, type Member } from '../auth/member.ts';
import { registerOriginGuard } from '../plugins/origin-guard.ts';
import { RateLimiter } from '../security/rate-limiter.ts';
import { deleteLibraryItem, listLibrary } from '../social/social-media.ts';
import { getSocialSettings, pinterestBoards, saveSocialSettings, socialAccounts, socialAnalytics, socialOverview } from '../social/social-overview.ts';
import { createSocialPost, deleteSocialPost, getSocialPost, listSocialPosts, rescheduleSocialPost, retrySocialPost, unpublishSocialPost, updateSocialPost } from '../social/social-posts.ts';
import { ZernioServiceError, type ZernioContext } from '../zernio/zernio-service.ts';

export interface SocialRoutesOptions {
  auth: Auth;
  context: ZernioContext;
  trustedOrigins: readonly string[];
}

/**
 * Redes Sociais, em /api/internal/social (PLANO_MODULO_REDES_SOCIAIS): visão geral, publicações, fuso, métricas e
 * biblioteca. Empresa e papel vêm da sessão; a chave da Zernio nunca sai da API; o texto das publicações não vai para o log.
 */
export const socialRoutes: FastifyPluginAsync<SocialRoutesOptions> = async (app, { auth, context, trustedOrigins }) => {
  registerOriginGuard(app, trustedOrigins);
  registerMemberContext(app, { auth, db: context.db });

  // Por empresa: publicar, alterar e excluir 30/min (a Zernio aceita 25 posts/h por conta); fuso e biblioteca 20/min
  const writeLimiter = new RateLimiter(30, 60_000);
  const settingsLimiter = new RateLimiter(20, 60_000);
  const TOO_MANY = 'Muitas ações seguidas. Aguarde um pouco e tente de novo.';

  const handle =
    <T>(fn: (request: FastifyRequest, member: Member) => Promise<T>) =>
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        return await fn(request, request.member as Member);
      } catch (err) {
        if (err instanceof ZernioServiceError) {
          if (err.diagnostic) request.log.warn({ acao: 'redes.recusa', empresa: request.member?.organizationId, ...err.diagnostic }, 'a Zernio recusou o pedido');
          return sendProblem(request, reply, err.status, err.message);
        }
        throw err;
      }
    };
  const limit = (limiter: RateLimiter, member: Member) => {
    if (!limiter.allow(member.organizationId)) throw new ZernioServiceError(429, TOO_MANY);
  };
  const audit = (request: FastifyRequest, member: Member, acao: string, extra: Record<string, unknown> = {}) =>
    request.log.info({ acao, ator: member.userId, empresa: member.organizationId, ...extra }, 'redes sociais');
  const id = (request: FastifyRequest) => (request.params as { id: string }).id;

  app.get('/overview', handle((_request, member) => socialOverview(context, member)));
  app.get('/accounts', handle((_request, member) => socialAccounts(context, member)));
  app.get(
    '/accounts/:accountId/pinterest-boards',
    handle((request, member) => pinterestBoards(context, member, (request.params as { accountId: string }).accountId)),
  );

  app.get('/posts', handle((request, member) => listSocialPosts(context, member, request.query)));
  app.get('/posts/:id', handle((request, member) => getSocialPost(context, member, id(request))));

  app.post('/posts', async (request, reply) => {
    const result = await handle(async (req, member) => {
      limit(writeLimiter, member);
      const created = await createSocialPost(context, member, req.body);
      audit(req, member, created.replayed ? 'redes.publicacao.repetida' : `redes.publicacao.${created.post.status}`, {
        publicacao: created.post.id,
        redes: created.post.targets.map((target) => `${target.platform}:${target.status}`),
      });
      return created;
    })(request, reply);
    return reply.sent ? reply : reply.status(201).send(result);
  });

  app.put(
    '/posts/:id',
    handle(async (request, member) => {
      limit(writeLimiter, member);
      const updated = await updateSocialPost(context, member, id(request), request.body);
      audit(request, member, 'redes.publicacao.alterada', { publicacao: updated.post.id, situacao: updated.post.status });
      return updated;
    }),
  );

  app.delete('/posts/:id', async (request, reply) => {
    await handle(async (req, member) => {
      limit(writeLimiter, member);
      await deleteSocialPost(context, member, id(req));
      audit(req, member, 'redes.publicacao.excluida', { publicacao: id(req) });
      return null;
    })(request, reply);
    return reply.sent ? reply : reply.status(204).send();
  });

  app.post(
    '/posts/:id/retry',
    handle(async (request, member) => {
      limit(writeLimiter, member);
      const result = await retrySocialPost(context, member, id(request));
      audit(request, member, 'redes.publicacao.nova_tentativa', { publicacao: result.post.id, situacao: result.post.status });
      return result;
    }),
  );

  app.post(
    '/posts/:id/reschedule',
    handle(async (request, member) => {
      limit(writeLimiter, member);
      const result = await rescheduleSocialPost(context, member, id(request), request.body);
      audit(request, member, 'redes.publicacao.reagendada', { publicacao: result.post.id });
      return result;
    }),
  );

  app.post(
    '/posts/:id/unpublish',
    handle(async (request, member) => {
      limit(writeLimiter, member);
      const result = await unpublishSocialPost(context, member, id(request), request.body);
      audit(request, member, 'redes.publicacao.removida_da_rede', { publicacao: result.post.id });
      return result;
    }),
  );

  app.get('/settings', handle((_request, member) => getSocialSettings(context, member)));
  app.put(
    '/settings',
    handle(async (request, member) => {
      limit(settingsLimiter, member);
      const saved = await saveSocialSettings(context, member, request.body);
      audit(request, member, 'redes.fuso.alterado', { fuso: saved.timezone });
      return saved;
    }),
  );

  app.get(
    '/analytics',
    handle(async (request, member) => {
      const parsed = socialAnalyticsQuerySchema.safeParse(request.query);
      if (!parsed.success) throw new ZernioServiceError(400, 'Período inválido.');
      return socialAnalytics(context, member, parsed.data.days);
    }),
  );

  app.get('/media', handle((_request, member) => listLibrary(context.db, member)));
  app.delete('/media/:id', async (request, reply) => {
    await handle(async (req, member) => {
      limit(settingsLimiter, member);
      await deleteLibraryItem(context.db, member, id(req));
      audit(req, member, 'redes.biblioteca.excluida', { imagem: id(req) });
      return null;
    })(request, reply);
    return reply.sent ? reply : reply.status(204).send();
  });
};
