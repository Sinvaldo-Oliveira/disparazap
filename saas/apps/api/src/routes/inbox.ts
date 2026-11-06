import type { ServerResponse } from 'node:http';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { InboxSendResult, InboxStreamEvent } from '@disparazap/contracts';
import type { Auth } from '../auth/auth.ts';
import { registerMemberContext, sendProblem, type Member } from '../auth/member.ts';
import {
  canSeeEvent,
  getConversation,
  InboxError,
  listChannels,
  listConversations,
  markConversationRead,
  requireInboxAccess,
  sendInboxMessage,
  setInboxReception,
  type InboxContext,
} from '../inbox/inbox-service.ts';
import { registerOriginGuard } from '../plugins/origin-guard.ts';
import { socialInboxConversationsQuerySchema, socialInboxMessagesQuerySchema } from '@disparazap/contracts';
import { diagnoseSocialDates, listSocialConversations, listSocialMessages } from '../inbox/social-inbox.ts';
import { dbSendRegistry, sendSocialReply } from '../inbox/social-send.ts';
import { socialDateDiagnosticInputSchema, socialSendInputSchema } from '@disparazap/contracts';
import type { ZernioContext } from '../zernio/zernio-service.ts';
import { RateLimiter } from '../security/rate-limiter.ts';

export interface InboxRoutesOptions {
  auth: Auth;
  context: InboxContext;
  /** Leitura das conversas de redes sociais pela Zernio (Z2) */
  zernio: ZernioContext;
  /** Envio de respostas humanas pelo Instagram (Z3.2): desligado até a migração 0008 e a homologação autorizada */
  socialSendEnabled?: boolean;
  trustedOrigins: readonly string[];
  /** Canal em tempo real: intervalo do sinal de vida e duração máxima (o navegador reconecta sozinho e a sessão é conferida de novo) */
  streamHeartbeatMs?: number;
  streamMaxAgeMs?: number;
}

/** Conexões simultâneas do canal em tempo real por empresa (abas abertas) */
const MAX_STREAMS_PER_ORGANIZATION = 50;

/**
 * Inbox, em /api/internal/inbox (PLANO_MODULO_INBOX, I1). Empresa e papel vêm da sessão em todas as rotas; o painel
 * nunca fala com a Evolution Go; texto e número das mensagens não vão para o log (só ids e situação).
 */
export const inboxRoutes: FastifyPluginAsync<InboxRoutesOptions> = async (app, options) => {
  const { auth, context, trustedOrigins, zernio } = options;
  const heartbeatMs = options.streamHeartbeatMs ?? 25_000;
  const maxAgeMs = options.streamMaxAgeMs ?? 15 * 60_000;
  registerOriginGuard(app, trustedOrigins);
  registerMemberContext(app, { auth, db: context.db });

  // Por empresa: respostas 60/min; ligar ou desligar o recebimento 10/min
  const sendLimiter = new RateLimiter(60, 60_000);
  const activationLimiter = new RateLimiter(10, 60_000);
  // Leituras da Zernio: cada abertura de conversa gasta um pedido à Zernio
  const readLimiter = new RateLimiter(120, 60_000);
  const diagnosticLimiter = new RateLimiter(5, 60_000);
  const socialSendLimiter = new RateLimiter(20, 60_000);
  const TOO_MANY = 'Muitas ações seguidas. Aguarde um pouco e tente de novo.';

  const handle =
    <T>(fn: (request: FastifyRequest, member: Member) => Promise<T>) =>
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        return await fn(request, request.member as Member);
      } catch (err) {
        if (err instanceof InboxError) return sendProblem(request, reply, err.status, err.message);
        throw err;
      }
    };
  const limit = (limiter: RateLimiter, member: Member) => {
    if (!limiter.allow(member.organizationId)) throw new InboxError(429, TOO_MANY);
  };
  const audit = (request: FastifyRequest, member: Member, acao: string, extra: Record<string, unknown> = {}) =>
    request.log.info({ acao, ator: member.userId, empresa: member.organizationId, ...extra }, 'inbox');
  const id = (request: FastifyRequest) => (request.params as { id: string }).id;

  app.get('/channels', handle((_request, member) => listChannels(context, member)));

  const activation = (enabled: boolean) =>
    handle(async (request, member) => {
      requireInboxAccess(member);
      limit(activationLimiter, member);
      const result = await setInboxReception(context, member, id(request), enabled);
      audit(request, member, enabled ? 'inbox.recebimento.ligado' : 'inbox.recebimento.desligado', { instancia: id(request) });
      return result;
    });
  app.post('/channels/:id/activate', activation(true));
  app.delete('/channels/:id/activate', activation(false));

  app.get('/conversations', handle((request, member) => listConversations(context, member, request.query)));

  // ----- Envio de resposta humana pelo Instagram (Z3.2): só pessoa, com janela revalidada e registro antes da chamada -----
  app.post(
    '/social/messages',
    handle(async (request, member) => {
      limit(socialSendLimiter, member);
      const parsed = socialSendInputSchema.safeParse(request.body);
      if (!parsed.success) throw new InboxError(400, parsed.error.issues[0]?.message ?? 'Mensagem inválida.');
      const result = await sendSocialReply(zernio, member, { ...parsed.data, origin: 'humano' }, { enabled: options.socialSendEnabled ?? false, registry: dbSendRegistry(context.db) });
      audit(request, member, 'inbox.social.envio', { situacao: result.status, repetido: result.replayed });
      return result;
    }),
  );

  // ----- Diagnóstico temporário das datas (Z2.4): dono e administradores, uma conversa, até 10 mensagens, sem texto -----
  app.post(
    '/social/diagnostico-datas',
    handle(async (request, member) => {
      limit(diagnosticLimiter, member);
      const parsed = socialDateDiagnosticInputSchema.safeParse(request.body);
      if (!parsed.success) throw new InboxError(400, 'Escolha uma conversa e uma conta válidas.');
      const result = await diagnoseSocialDates(zernio, member, parsed.data.conversationId, parsed.data.accountId);
      audit(request, member, 'inbox.social.diagnostico_datas', { quantidade: result.readCount, ordem_aplicada: result.sortOrderApplied });
      return result;
    }),
  );

  // ----- Redes sociais (Z2): leitura direta da Zernio, sem gravar nada -----
  const parseQuery = <T>(schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false; error: { issues: { message: string }[] } } }, value: unknown): T => {
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw new InboxError(400, parsed.error.issues[0]?.message ?? 'Pedido inválido.');
    return parsed.data;
  };
  app.get(
    '/social/conversations',
    handle(async (request, member) => {
      limit(readLimiter, member);
      const query = parseQuery(socialInboxConversationsQuerySchema, request.query);
      const result = await listSocialConversations(zernio, member, query);
      audit(request, member, 'inbox.social.conversas', { quantidade: result.conversations.length });
      return result;
    }),
  );
  app.get(
    '/social/conversations/:id/messages',
    handle(async (request, member) => {
      limit(readLimiter, member);
      const query = parseQuery(socialInboxMessagesQuerySchema, request.query);
      const result = await listSocialMessages(zernio, member, id(request), query);
      audit(request, member, 'inbox.social.mensagens', { quantidade: result.messages.length });
      return result;
    }),
  );
  app.get('/conversations/:id', handle((request, member) => getConversation(context, member, id(request), (request.query as { before?: unknown }).before)));

  app.post(
    '/conversations/:id/read',
    handle(async (request, member) => {
      await markConversationRead(context, member, id(request));
      return { ok: true };
    }),
  );

  app.post('/conversations/:id/messages', async (request, reply) => {
    const result = await handle(async (req, member) => {
      requireInboxAccess(member);
      limit(sendLimiter, member);
      const sent = await sendInboxMessage(context, member, id(req), req.body);
      audit(req, member, sent.replayed ? 'inbox.resposta.repetida' : 'inbox.resposta', { conversa: id(req), mensagem: sent.message.id, situacao: sent.message.status });
      return sent;
    })(request, reply);
    if (reply.sent) return reply;
    const sent = result as InboxSendResult;
    return reply.status(sent.replayed ? 200 : 201).send(sent);
  });

  // ----- Tempo real (SSE): só avisa o que mudou (ids); o painel busca o conteúdo pelas rotas acima -----
  const openStreams = new Set<ServerResponse>();
  const streamsByOrganization = new Map<string, number>();

  app.addHook('preClose', async () => {
    for (const raw of openStreams) raw.end();
    openStreams.clear();
  });

  app.get('/stream', async (request, reply) => {
    const member = request.member as Member;
    try {
      requireInboxAccess(member);
    } catch (err) {
      if (err instanceof InboxError) return sendProblem(request, reply, err.status, err.message);
      throw err;
    }
    const current = streamsByOrganization.get(member.organizationId) ?? 0;
    if (current >= MAX_STREAMS_PER_ORGANIZATION) return sendProblem(request, reply, 429, 'Há muitas abas da Inbox abertas nesta empresa. Feche algumas e recarregue.');

    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-store, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
      'x-content-type-options': 'nosniff',
      'x-request-id': request.id,
    });
    const send = (event: InboxStreamEvent) => {
      if (!raw.writableEnded) raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    // O navegador espera 3 s para reconectar se a conexão cair
    raw.write('retry: 3000\n\n');
    send({ type: 'ready', conversationId: null });

    streamsByOrganization.set(member.organizationId, current + 1);
    openStreams.add(raw);
    const unsubscribe = context.bus.subscribe(member.organizationId, (event) => {
      if (event.type === 'conversation' && !canSeeEvent(member, event.assignedUserId)) return;
      send({ type: event.type, conversationId: event.conversationId });
    });
    const heartbeat = setInterval(() => {
      if (!raw.writableEnded) raw.write(': ping\n\n');
    }, heartbeatMs);
    const expiry = setTimeout(() => raw.end(), maxAgeMs);

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      clearInterval(heartbeat);
      clearTimeout(expiry);
      unsubscribe();
      openStreams.delete(raw);
      const left = (streamsByOrganization.get(member.organizationId) ?? 1) - 1;
      if (left > 0) streamsByOrganization.set(member.organizationId, left);
      else streamsByOrganization.delete(member.organizationId);
    };
    raw.on('close', cleanup);
    raw.on('finish', cleanup);
    request.raw.on('close', () => {
      cleanup();
      if (!raw.writableEnded) raw.end();
    });
  });
};
