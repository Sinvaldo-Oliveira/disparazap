import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodType } from 'zod';
import {
  MEDIA_LIMITS,
  contactListInputSchema,
  contactListRenameSchema,
  contactSearchQuerySchema,
  contactUpdateInputSchema,
  contactsAddInputSchema,
  contactsRemoveInputSchema,
  messageTemplateInputSchema,
  sendTextInputSchema,
} from '@disparazap/contracts';
import type { Auth } from '../auth/auth.ts';
import { registerMemberContext, sendProblem, type Member } from '../auth/member.ts';
import {
  MessagingError,
  addContacts,
  createContactList,
  deleteContactList,
  getContactList,
  listContactLists,
  removeContacts,
  renameContactList,
  searchContacts,
  updateContact,
  updateContactList,
} from '../messaging/contact-lists.ts';
import { cleanFileName, readMedia, saveMedia } from '../messaging/media.ts';
import { sendText } from '../messaging/send-text.ts';
import { createTemplate, deleteTemplate, listTemplates, updateTemplate } from '../messaging/templates.ts';
import { registerOriginGuard } from '../plugins/origin-guard.ts';
import { RateLimiter } from '../security/rate-limiter.ts';
import { WhatsAppError, type WhatsAppContext } from '../whatsapp/whatsapp-service.ts';

export interface MessagingRoutesOptions {
  auth: Auth;
  context: WhatsAppContext;
  trustedOrigins: readonly string[];
}

/** Uma lista de 10 mil contatos com nomes longos passa de 1 MB (limite geral da API) */
const LIST_BODY_LIMIT = 3 * 1024 * 1024;

/** Envio de Mensagens e Contatos, em /api/internal: listas de contatos, imagens, modelos e envio. Empresa e papel vêm da sessão */
export const messagingRoutes: FastifyPluginAsync<MessagingRoutesOptions> = async (app, { auth, context, trustedOrigins }) => {
  registerOriginGuard(app, trustedOrigins);
  registerMemberContext(app, { auth, db: context.db });

  // Envio: 60 por minuto por instância (o intervalo mínimo do painel é 1 s). Listas: 30 gravações por minuto por empresa.
  // Contatos avulsos (alterar ou remover na página Contatos): 120 por minuto por empresa
  const sendLimiter = new RateLimiter(60, 60_000);
  const listWriteLimiter = new RateLimiter(30, 60_000);
  const contactEditLimiter = new RateLimiter(120, 60_000);

  const handle =
    <T>(fn: (request: FastifyRequest, member: Member) => Promise<T>) =>
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        return await fn(request, request.member as Member);
      } catch (err) {
        if (err instanceof MessagingError || err instanceof WhatsAppError) return sendProblem(request, reply, err.status, err.message);
        throw err;
      }
    };

  const param = (request: FastifyRequest) => (request.params as { id: string }).id;
  const parseWith = <T>(schema: ZodType<T>, value: unknown): T => {
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw new MessagingError(400, parsed.error.issues[0]?.message ?? 'Dados inválidos.');
    return parsed.data;
  };
  const parseList = (body: unknown) => parseWith(contactListInputSchema, body);
  const TOO_MANY = 'Muitas alterações seguidas. Aguarde um pouco e tente de novo.';
  const limitWrites = (member: Member) => {
    if (!listWriteLimiter.allow(member.organizationId)) throw new MessagingError(429, TOO_MANY);
  };
  const limitContactEdits = (member: Member) => {
    if (!contactEditLimiter.allow(member.organizationId)) throw new MessagingError(429, TOO_MANY);
  };

  app.get('/contact-lists', handle((_request, member) => listContactLists(context.db, member)));

  app.get('/contact-lists/:id', handle((request, member) => getContactList(context.db, member, param(request))));

  app.post('/contact-lists', { bodyLimit: LIST_BODY_LIMIT }, async (request, reply) => {
    const result = await handle(async (req, member) => {
      limitWrites(member);
      const saved = await createContactList(context.db, member, parseList(req.body));
      req.log.info({ acao: 'contatos.lista.criada', ator: member.userId, empresa: member.organizationId, lista: saved.list.id, contatos: saved.list.contactCount }, 'lista de contatos criada');
      return saved;
    })(request, reply);
    return reply.sent ? reply : reply.status(201).send(result);
  });

  app.put(
    '/contact-lists/:id',
    { bodyLimit: LIST_BODY_LIMIT },
    handle(async (request, member) => {
      limitWrites(member);
      const saved = await updateContactList(context.db, member, param(request), parseList(request.body));
      request.log.info({ acao: 'contatos.lista.atualizada', ator: member.userId, lista: saved.list.id, contatos: saved.list.contactCount }, 'lista de contatos atualizada');
      return saved;
    }),
  );

  app.delete('/contact-lists/:id', async (request, reply) => {
    await handle(async (req, member) => {
      limitWrites(member);
      await deleteContactList(context.db, member, param(req));
      req.log.info({ acao: 'contatos.lista.excluida', ator: member.userId, lista: param(req) }, 'lista de contatos excluída');
      return null;
    })(request, reply);
    return reply.sent ? reply : reply.status(204).send();
  });

  // ----- Página Contatos: uma alteração por vez, gravada na hora. Telefones vão no corpo, nunca na URL nem no log -----
  app.patch(
    '/contact-lists/:id',
    handle(async (request, member) => {
      limitWrites(member);
      const list = await renameContactList(context.db, member, param(request), parseWith(contactListRenameSchema, request.body));
      request.log.info({ acao: 'contatos.lista.renomeada', ator: member.userId, lista: list.id }, 'lista de contatos renomeada');
      return list;
    }),
  );

  app.post(
    '/contact-lists/:id/contacts',
    { bodyLimit: LIST_BODY_LIMIT },
    handle(async (request, member) => {
      limitWrites(member);
      const result = await addContacts(context.db, member, param(request), parseWith(contactsAddInputSchema, request.body));
      request.log.info({ acao: 'contatos.adicionados', ator: member.userId, lista: result.list.id, adicionados: result.added }, 'contatos adicionados');
      return result;
    }),
  );

  app.patch(
    '/contact-lists/:id/contacts',
    handle(async (request, member) => {
      limitContactEdits(member);
      const result = await updateContact(context.db, member, param(request), parseWith(contactUpdateInputSchema, request.body));
      request.log.info({ acao: 'contatos.contato.alterado', ator: member.userId, lista: result.list.id }, 'contato alterado');
      return result;
    }),
  );

  app.post(
    '/contact-lists/:id/contacts/remove',
    handle(async (request, member) => {
      limitContactEdits(member);
      const result = await removeContacts(context.db, member, param(request), parseWith(contactsRemoveInputSchema, request.body));
      request.log.info({ acao: 'contatos.removidos', ator: member.userId, lista: result.list.id, removidos: result.removed }, 'contatos removidos');
      return result;
    }),
  );

  // Busca em todas as listas da empresa (a query string não vai para o log)
  app.get(
    '/contacts/search',
    handle((request, member) => searchContacts(context.db, member, parseWith(contactSearchQuerySchema, request.query).q)),
  );

  // ----- Imagens: o corpo é o próprio arquivo (image/jpeg, image/png ou image/webp), até 5 MB -----
  app.addContentTypeParser([...MEDIA_LIMITS.mimeTypes], { parseAs: 'buffer', bodyLimit: MEDIA_LIMITS.maxBytes }, (_request, body, done) => done(null, body));

  app.post('/media', { bodyLimit: MEDIA_LIMITS.maxBytes }, async (request, reply) => {
    const result = await handle(async (req, member) => {
      if (!Buffer.isBuffer(req.body)) throw new MessagingError(415, 'Use uma imagem JPG, PNG ou WebP.');
      limitWrites(member);
      // Nome do arquivo opcional (?name=), para a busca na biblioteca de mídia das Redes Sociais
      const saved = await saveMedia(context.db, member, req.body, cleanFileName((req.query as { name?: unknown }).name));
      req.log.info({ acao: 'mensagens.imagem.enviada', ator: member.userId, imagem: saved.id, bytes: saved.size }, 'imagem enviada');
      return saved;
    })(request, reply);
    return reply.sent ? reply : reply.status(201).send(result);
  });

  app.get('/media/:id', async (request, reply) => {
    try {
      const { mimeType, data } = await readMedia(context.db, (request.member as Member).organizationId, param(request));
      return reply.type(mimeType).header('content-disposition', 'inline').send(data);
    } catch (err) {
      if (err instanceof MessagingError) return sendProblem(request, reply, err.status, err.message);
      throw err;
    }
  });

  // ----- Modelos de mensagem -----
  const parseTemplate = (body: unknown) => parseWith(messageTemplateInputSchema, body);

  app.get('/message-templates', handle((_request, member) => listTemplates(context.db, member)));

  app.post('/message-templates', async (request, reply) => {
    const result = await handle(async (req, member) => {
      limitWrites(member);
      const saved = await createTemplate(context.db, member, parseTemplate(req.body));
      req.log.info({ acao: 'mensagens.modelo.criado', ator: member.userId, modelo: saved.id }, 'modelo de mensagem criado');
      return saved;
    })(request, reply);
    return reply.sent ? reply : reply.status(201).send(result);
  });

  app.put(
    '/message-templates/:id',
    handle(async (request, member) => {
      limitWrites(member);
      return updateTemplate(context.db, member, param(request), parseTemplate(request.body));
    }),
  );

  app.delete('/message-templates/:id', async (request, reply) => {
    await handle(async (req, member) => {
      limitWrites(member);
      await deleteTemplate(context.db, member, param(req));
      return null;
    })(request, reply);
    return reply.sent ? reply : reply.status(204).send();
  });

  // Nada do envio vai para o log: número e texto são dados pessoais
  app.post(
    '/messaging/send',
    handle(async (request, member) => {
      const parsed = sendTextInputSchema.safeParse(request.body);
      if (!parsed.success) throw new MessagingError(400, parsed.error.issues[0]?.message ?? 'Dados inválidos.');
      if (!sendLimiter.allow(`${member.organizationId}:${parsed.data.instanceId}`)) throw new MessagingError(429, 'Envios rápidos demais para esta instância. Aumente o intervalo entre as mensagens.');
      return sendText(context, member, parsed.data);
    }),
  );
};
