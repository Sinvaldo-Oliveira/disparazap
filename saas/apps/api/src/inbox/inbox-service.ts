import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gt, ilike, isNull, lt, ne, or, sql, type SQL } from 'drizzle-orm';
import {
  INBOX_LIMITS,
  inboxConversationsQuerySchema,
  inboxSendInputSchema,
  type InboxChannelsResponse,
  type InboxControlMode,
  type InboxConversation,
  type InboxConversationDetail,
  type InboxConversationsResponse,
  type InboxMessage,
  type InboxSendResult,
} from '@disparazap/contracts';
import {
  inboxContacts,
  inboxConversationEvents,
  inboxConversations,
  inboxMessages,
  inboxReceptionGaps,
  users,
  whatsappInstances,
  type AppDatabase,
} from '@disparazap/db';
import { canManage, canOperate, type Member } from '../auth/member.ts';
import { ProviderError, type ProviderErrorKind } from '../integrations/whatsapp-provider.ts';
import { loadInstance, markDisconnected, openToken, readyProvider, WhatsAppError, type WhatsAppContext } from '../whatsapp/whatsapp-service.ts';
import type { EvolutionEventStream } from './evolution-events.ts';
import type { InboxBus } from './inbox-bus.ts';
import { applyPendingReceipt, previewOf, touchConversation } from './inbox-ingest.ts';

/**
 * Inbox (PLANO_MODULO_INBOX, I1). Empresa e papel sempre da sessão; o atendente (operador) vê as conversas dele e a fila
 * sem responsável (N4); o visualizador não tem Inbox (N3). Conteúdo de mensagem e número nunca vão para o log.
 */
export class InboxError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'InboxError';
    this.status = status;
  }
}

export interface InboxContext {
  db: AppDatabase;
  whatsapp: WhatsAppContext;
  bus: InboxBus;
  /** Consumidor dos eventos (null = recebimento desligado por configuração) */
  stream: EvolutionEventStream | null;
  /** Botão "Receber mensagens na Inbox" liberado (só depois da homologação: INBOX_ACTIVATION_ENABLED) */
  activationEnabled: boolean;
}

const NO_ACCESS = 'A Inbox é usada pelo dono, pelos administradores e pelos atendentes (operadores) da empresa.';
const NOT_FOUND = 'Conversa não encontrada.';
export const ACTIVATION_LOCKED =
  'O recebimento de mensagens na Inbox ainda não foi liberado nesta plataforma: ele é ativado depois da homologação com uma instância de teste.';

export function requireInboxAccess(member: Member) {
  if (!canOperate(member)) throw new InboxError(403, NO_ACCESS);
}

/** Operador: só as conversas dele e as sem responsável; dono e administradores veem todas */
function visibleTo(member: Member): SQL | undefined {
  if (canManage(member)) return undefined;
  return or(eq(inboxConversations.assignedUserId, member.userId), isNull(inboxConversations.assignedUserId));
}

// ----- Canais e recebimento -----

export async function listChannels(ctx: InboxContext, member: Member): Promise<InboxChannelsResponse> {
  requireInboxAccess(member);
  const instances = await ctx.db
    .select({ id: whatsappInstances.id, name: whatsappInstances.displayName, phone: whatsappInstances.phoneE164, status: whatsappInstances.status, inboxEnabledAt: whatsappInstances.inboxEnabledAt })
    .from(whatsappInstances)
    .where(and(eq(whatsappInstances.organizationId, member.organizationId), isNull(whatsappInstances.deletedAt)))
    .orderBy(asc(whatsappInstances.createdAt));
  const unread = await ctx.db
    .select({ accountId: inboxConversations.accountId, total: sql<number>`coalesce(sum(${inboxConversations.unreadCount}), 0)::int` })
    .from(inboxConversations)
    .where(and(eq(inboxConversations.organizationId, member.organizationId), visibleTo(member)))
    .groupBy(inboxConversations.accountId);
  const unreadBy = new Map(unread.map((row) => [row.accountId, Number(row.total)]));
  const gaps = await ctx.db
    .select({ accountId: inboxReceptionGaps.accountId, startedAt: inboxReceptionGaps.startedAt, endedAt: inboxReceptionGaps.endedAt })
    .from(inboxReceptionGaps)
    .where(and(eq(inboxReceptionGaps.organizationId, member.organizationId), or(isNull(inboxReceptionGaps.endedAt), gt(inboxReceptionGaps.endedAt, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)))))
    .orderBy(desc(inboxReceptionGaps.startedAt))
    .limit(10);
  return {
    channels: instances.map((row) => ({
      id: row.id,
      type: 'whatsapp' as const,
      name: row.name,
      phone: row.phone,
      connected: row.status === 'connected',
      inboxEnabledAt: row.inboxEnabledAt?.toISOString() ?? null,
      unreadCount: unreadBy.get(row.id) ?? 0,
    })),
    reception: ctx.stream ? { state: ctx.stream.state, since: ctx.stream.since?.toISOString() ?? null } : { state: 'disabled', since: null },
    gaps: gaps.map((gap) => ({ accountId: gap.accountId, startedAt: gap.startedAt.toISOString(), endedAt: gap.endedAt?.toISOString() ?? null })),
    activationAvailable: ctx.activationEnabled,
    canManage: canManage(member),
  };
}

/** Liga ou desliga o recebimento numa instância da empresa (só depois da homologação; nunca automático) */
export async function setInboxReception(ctx: InboxContext, member: Member, accountId: string, enabled: boolean): Promise<InboxChannelsResponse> {
  requireInboxAccess(member);
  if (!canManage(member)) throw new InboxError(403, 'Só o dono e os administradores ligam o recebimento na Inbox.');
  if (!ctx.activationEnabled) throw new InboxError(409, ACTIVATION_LOCKED);
  try {
    const row = await loadInstance(ctx.whatsapp, member, accountId);
    const { vault, provider } = await readyProvider(ctx.whatsapp);
    const token = await openToken(ctx.whatsapp, vault, row);
    await provider.configureInboxEvents(token, enabled);
    await ctx.db
      .update(whatsappInstances)
      .set({ inboxEnabledAt: enabled ? new Date() : null, updatedAt: new Date() })
      .where(and(eq(whatsappInstances.organizationId, member.organizationId), eq(whatsappInstances.id, row.id)));
  } catch (err) {
    if (err instanceof WhatsAppError) throw new InboxError(err.status, err.message);
    if (err instanceof ProviderError) throw new InboxError(502, 'O servidor de WhatsApp não aceitou a configuração. Nada foi alterado na instância.');
    throw err;
  }
  await ctx.stream?.refreshAuthorized();
  return listChannels(ctx, member);
}

// ----- Conversas e mensagens -----

const conversationColumns = {
  id: inboxConversations.id,
  channel: inboxConversations.channel,
  accountId: inboxConversations.accountId,
  externalId: inboxConversations.externalId,
  accountName: whatsappInstances.displayName,
  contactId: inboxContacts.id,
  contactName: inboxContacts.displayName,
  contactPhone: inboxContacts.phoneE164,
  status: inboxConversations.status,
  controlMode: inboxConversations.controlMode,
  controlVersion: inboxConversations.controlVersion,
  assignedUserId: inboxConversations.assignedUserId,
  assignedName: users.name,
  unreadCount: inboxConversations.unreadCount,
  lastMessageAt: inboxConversations.lastMessageAt,
  lastMessagePreview: inboxConversations.lastMessagePreview,
  lastMessageDirection: inboxConversations.lastMessageDirection,
};

type ConversationRow = {
  id: string;
  channel: string;
  accountId: string;
  externalId: string;
  accountName: string | null;
  contactId: string | null;
  contactName: string | null;
  contactPhone: string | null;
  status: string;
  controlMode: string;
  controlVersion: number;
  assignedUserId: string | null;
  assignedName: string | null;
  unreadCount: number;
  lastMessageAt: Date | null;
  lastMessagePreview: string | null;
  lastMessageDirection: string | null;
};

function toPublicConversation(row: ConversationRow): InboxConversation {
  return {
    id: row.id,
    channel: 'whatsapp',
    accountId: row.accountId,
    accountName: row.accountName ?? 'WhatsApp',
    contact: { id: row.contactId ?? '', name: row.contactName, phone: row.contactPhone },
    status: row.status as InboxConversation['status'],
    controlMode: row.controlMode as InboxControlMode,
    controlVersion: row.controlVersion,
    assignedTo: row.assignedUserId ? { id: row.assignedUserId, name: row.assignedName ?? 'Atendente' } : null,
    unreadCount: row.unreadCount,
    lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
    lastMessagePreview: row.lastMessagePreview,
    lastMessageDirection: row.lastMessageDirection === 'inbound' || row.lastMessageDirection === 'outbound' ? row.lastMessageDirection : null,
  };
}

function conversationsQuery(ctx: InboxContext) {
  return ctx.db
    .select(conversationColumns)
    .from(inboxConversations)
    .innerJoin(inboxContacts, and(eq(inboxContacts.organizationId, inboxConversations.organizationId), eq(inboxContacts.id, inboxConversations.contactId)))
    .innerJoin(whatsappInstances, eq(whatsappInstances.id, inboxConversations.accountId))
    .leftJoin(users, eq(users.id, inboxConversations.assignedUserId));
}

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);

export async function listConversations(ctx: InboxContext, member: Member, rawQuery: unknown): Promise<InboxConversationsResponse> {
  requireInboxAccess(member);
  const parsed = inboxConversationsQuerySchema.safeParse(rawQuery);
  if (!parsed.success) throw new InboxError(400, parsed.error.issues[0]?.message ?? 'Filtro inválido.');
  const query = parsed.data;
  const filters: (SQL | undefined)[] = [eq(inboxConversations.organizationId, member.organizationId), visibleTo(member)];
  if (query.channel) filters.push(eq(inboxConversations.channel, query.channel));
  if (query.accountId) filters.push(eq(inboxConversations.accountId, query.accountId));
  if (query.filter === 'unread') filters.push(gt(inboxConversations.unreadCount, 0));
  if (query.filter === 'open') filters.push(ne(inboxConversations.status, 'closed'));
  if (query.filter === 'closed') filters.push(eq(inboxConversations.status, 'closed'));
  if (query.before) filters.push(lt(inboxConversations.lastMessageAt, new Date(query.before)));
  if (query.search) {
    const term = `%${escapeLike(query.search)}%`;
    const digits = query.search.replace(/\D/g, '');
    filters.push(or(ilike(inboxContacts.displayName, term), ...(digits.length >= 3 ? [ilike(inboxContacts.phoneE164, `%${digits}%`)] : [])));
  }
  const rows = await conversationsQuery(ctx)
    .where(and(...filters))
    .orderBy(sql`${inboxConversations.lastMessageAt} desc nulls last`, desc(inboxConversations.createdAt))
    .limit(INBOX_LIMITS.pageSize + 1);
  return { conversations: rows.slice(0, INBOX_LIMITS.pageSize).map(toPublicConversation), hasMore: rows.length > INBOX_LIMITS.pageSize, canSend: canOperate(member) };
}

async function loadConversation(ctx: InboxContext, member: Member, id: string): Promise<ConversationRow> {
  if (!id || id.length > 100) throw new InboxError(404, NOT_FOUND);
  const [row] = await conversationsQuery(ctx)
    .where(and(eq(inboxConversations.organizationId, member.organizationId), eq(inboxConversations.id, id), visibleTo(member)))
    .limit(1);
  // De outra empresa ou de outro atendente: igual a inexistente
  if (!row) throw new InboxError(404, NOT_FOUND);
  return row;
}

type MessageRow = typeof inboxMessages.$inferSelect;

function toPublicMessage(row: MessageRow, authorName: string | null): InboxMessage {
  return {
    id: row.id,
    direction: row.direction as InboxMessage['direction'],
    author: row.author as InboxMessage['author'],
    authorName: row.author === 'user' ? authorName : null,
    contentType: row.contentType as InboxMessage['contentType'],
    mediaKind: row.mediaKind,
    text: row.body,
    status: row.status as InboxMessage['status'],
    error: row.errorReason,
    sentAt: row.sentAt.toISOString(),
  };
}

async function messagesOf(ctx: InboxContext, member: Member, conversationId: string, before: Date | null) {
  const rows = await ctx.db
    .select({ message: inboxMessages, authorName: users.name })
    .from(inboxMessages)
    .leftJoin(users, eq(users.id, inboxMessages.authorUserId))
    .where(and(eq(inboxMessages.organizationId, member.organizationId), eq(inboxMessages.conversationId, conversationId), ...(before ? [lt(inboxMessages.sentAt, before)] : [])))
    .orderBy(desc(inboxMessages.sentAt), desc(inboxMessages.createdAt))
    .limit(INBOX_LIMITS.messagesPage + 1);
  const hasMore = rows.length > INBOX_LIMITS.messagesPage;
  return { messages: rows.slice(0, INBOX_LIMITS.messagesPage).reverse().map((row) => toPublicMessage(row.message, row.authorName)), hasMore };
}

export async function getConversation(ctx: InboxContext, member: Member, id: string, beforeRaw: unknown): Promise<InboxConversationDetail> {
  requireInboxAccess(member);
  const row = await loadConversation(ctx, member, id);
  const before = typeof beforeRaw === 'string' && !Number.isNaN(Date.parse(beforeRaw)) ? new Date(beforeRaw) : null;
  const { messages, hasMore } = await messagesOf(ctx, member, row.id, before);
  return { conversation: toPublicConversation(row), messages, hasMore, canSend: canOperate(member) };
}

/** Lida no painel: zera as não lidas (só no DisparaZap; não manda confirmação de leitura ao contato) */
export async function markConversationRead(ctx: InboxContext, member: Member, id: string): Promise<void> {
  requireInboxAccess(member);
  const row = await loadConversation(ctx, member, id);
  if (row.unreadCount === 0) return;
  await ctx.db.update(inboxConversations).set({ unreadCount: 0, updatedAt: new Date() }).where(and(eq(inboxConversations.organizationId, member.organizationId), eq(inboxConversations.id, row.id)));
  ctx.bus.publish({ organizationId: member.organizationId, type: 'conversation', conversationId: row.id, assignedUserId: row.assignedUserId });
}

// ----- Controle do atendimento (plano §E.5) -----

/**
 * Trava das respostas automáticas: uma resposta de IA ou automação gerada no modo `mode` e na versão `version` só pode
 * sair se a conversa ainda estiver no mesmo modo e na mesma versão (um humano que assume muda a versão). Usada pelos
 * módulos futuros; nesta etapa só o atendente humano envia.
 */
export async function canDeliverAutomated(db: AppDatabase, organizationId: string, conversationId: string, mode: 'ai' | 'automation', version: number): Promise<boolean> {
  const [row] = await db
    .select({ id: inboxConversations.id })
    .from(inboxConversations)
    .where(and(eq(inboxConversations.organizationId, organizationId), eq(inboxConversations.id, conversationId), eq(inboxConversations.controlMode, mode), eq(inboxConversations.controlVersion, version)))
    .limit(1);
  return Boolean(row);
}

type Tx = Parameters<Parameters<AppDatabase['transaction']>[0]>[0];

/** O atendente humano assume: modo "human", versão nova se o modo mudou, responsável se não havia, conversa reaberta */
async function takeHumanControl(tx: Tx, member: Member, row: ConversationRow) {
  const modeChanged = row.controlMode !== 'human';
  const assign = !row.assignedUserId;
  const reopen = row.status === 'closed';
  if (!modeChanged && !assign && !reopen) return;
  await tx
    .update(inboxConversations)
    .set({
      controlMode: 'human',
      ...(modeChanged ? { controlVersion: sql`${inboxConversations.controlVersion} + 1` } : {}),
      ...(assign ? { assignedUserId: member.userId } : {}),
      ...(reopen ? { status: 'open' } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(inboxConversations.organizationId, member.organizationId), eq(inboxConversations.id, row.id)));
  const events: { type: string; data: Record<string, string | number | null> }[] = [
    ...(modeChanged ? [{ type: 'control_changed', data: { de: row.controlMode, para: 'human' } }] : []),
    ...(assign ? [{ type: 'assigned', data: { para: member.userId } }] : []),
    ...(reopen ? [{ type: 'reopened', data: { motivo: 'resposta_do_atendente' } }] : []),
  ];
  for (const event of events) {
    await tx.insert(inboxConversationEvents).values({ id: randomUUID(), organizationId: member.organizationId, conversationId: row.id, type: event.type, actorUserId: member.userId, data: event.data });
  }
}

// ----- Envio de texto -----

const SEND_FAILURES: Readonly<Record<ProviderErrorKind, string>> = {
  disconnected: 'O WhatsApp desta conta está desconectado. Reconecte em Integrações e tente de novo.',
  not_found: 'Esta instância não existe mais no servidor de WhatsApp.',
  unauthorized: 'O servidor de WhatsApp recusou a credencial desta instância.',
  invalid_number: 'O WhatsApp não aceitou o número deste contato.',
  unreachable: 'O servidor de WhatsApp não respondeu a tempo. A mensagem pode ter saído: confira antes de enviar de novo.',
  rejected: 'O servidor de WhatsApp não aceitou este envio.',
  invalid_response: 'O servidor de WhatsApp respondeu de um jeito inesperado a este envio.',
};

async function replay(ctx: InboxContext, member: Member, requestId: string): Promise<InboxSendResult | null> {
  const [found] = await ctx.db
    .select({ message: inboxMessages, authorName: users.name })
    .from(inboxMessages)
    .leftJoin(users, eq(users.id, inboxMessages.authorUserId))
    .where(and(eq(inboxMessages.organizationId, member.organizationId), eq(inboxMessages.clientRequestId, requestId)))
    .limit(1);
  return found ? { message: toPublicMessage(found.message, found.authorName), replayed: true } : null;
}

/**
 * Destino do envio: o número do contato; sem número (contato só com LID), o identificador da conversa. O envio para LID
 * ainda precisa ser confirmado na homologação (HOMOLOGACAO_I0, P5).
 */
const destinationOf = (row: ConversationRow): string => row.contactPhone ?? row.externalId;

/**
 * Resposta do atendente. O mesmo requestId nunca envia duas vezes (devolve o registro). A mensagem é gravada "pendente"
 * ANTES de chamar a Evolution: o eco SendMessage casa com ela. Sem resposta da Evolution, fica pendente (pode ter saído).
 */
export async function sendInboxMessage(ctx: InboxContext, member: Member, conversationId: string, raw: unknown): Promise<InboxSendResult> {
  requireInboxAccess(member);
  const parsed = inboxSendInputSchema.safeParse(raw);
  if (!parsed.success) throw new InboxError(400, parsed.error.issues[0]?.message ?? 'Mensagem inválida.');
  const { requestId, text } = parsed.data;
  const row = await loadConversation(ctx, member, conversationId);
  const previous = await replay(ctx, member, requestId);
  if (previous) return previous;

  const id = randomUUID();
  const now = new Date();
  let inserted = false;
  await ctx.db.transaction(async (tx) => {
    const created = await tx
      .insert(inboxMessages)
      .values({ id, organizationId: member.organizationId, conversationId: row.id, direction: 'outbound', author: 'user', authorUserId: member.userId, clientRequestId: requestId, contentType: 'text', body: text, status: 'pending', sentAt: now })
      .onConflictDoNothing()
      .returning({ id: inboxMessages.id });
    if (!created.length) return;
    inserted = true;
    await takeHumanControl(tx, member, row);
    await touchConversation(tx, { organizationId: member.organizationId, accountId: row.accountId }, row.id, { sentAt: now, preview: previewOf({ contentType: 'text', text, mediaKind: null }), direction: 'outbound' });
  });
  // Dois pedidos iguais ao mesmo tempo: o segundo devolve o primeiro
  if (!inserted) return (await replay(ctx, member, requestId)) as InboxSendResult;

  const account = { organizationId: member.organizationId, accountId: row.accountId };
  let status: 'sent' | 'pending' | 'failed' = 'failed';
  let errorReason: string | null = null;
  let externalId: string | null = null;
  try {
    const instance = await loadInstance(ctx.whatsapp, member, row.accountId);
    const { vault, provider } = await readyProvider(ctx.whatsapp);
    const token = await openToken(ctx.whatsapp, vault, instance);
    try {
      externalId = (await provider.sendText(token, destinationOf(row), text)).messageId;
      status = 'sent';
    } catch (err) {
      if (!(err instanceof ProviderError)) throw err;
      errorReason = SEND_FAILURES[err.kind];
      // Sem resposta: pode ter saído; fica pendente (o eco da Evolution confirma, se vier)
      status = err.kind === 'unreachable' ? 'pending' : 'failed';
      if (err.kind === 'disconnected' || err.kind === 'not_found') await markDisconnected(ctx.whatsapp, instance);
    }
  } catch (err) {
    if (!(err instanceof WhatsAppError)) throw err;
    errorReason = err.message;
  }

  await ctx.db.transaction(async (tx) => {
    if (externalId) {
      // O eco pode ter chegado antes e virado uma mensagem "api" com o mesmo id: a nossa fica, o eco sai
      await tx
        .delete(inboxMessages)
        .where(and(eq(inboxMessages.conversationId, row.id), eq(inboxMessages.externalId, externalId), eq(inboxMessages.author, 'api'), isNull(inboxMessages.clientRequestId)));
      const [current] = await tx.select({ externalId: inboxMessages.externalId, status: inboxMessages.status }).from(inboxMessages).where(eq(inboxMessages.id, id)).limit(1);
      await tx
        .update(inboxMessages)
        .set({ externalId, ...(current?.status === 'pending' ? { status: 'sent' } : {}), errorReason: null, updatedAt: new Date() })
        .where(eq(inboxMessages.id, id));
      await applyPendingReceipt(tx, account, externalId, id);
    } else {
      await tx.update(inboxMessages).set({ status: sql`case when ${inboxMessages.status} = 'pending' then ${status} else ${inboxMessages.status} end`, errorReason, updatedAt: new Date() }).where(eq(inboxMessages.id, id));
    }
  });
  const [assigned] = await ctx.db.select({ assignedUserId: inboxConversations.assignedUserId }).from(inboxConversations).where(eq(inboxConversations.id, row.id)).limit(1);
  ctx.bus.publish({ organizationId: member.organizationId, type: 'conversation', conversationId: row.id, assignedUserId: assigned?.assignedUserId ?? null });
  const saved = (await replay(ctx, member, requestId)) as InboxSendResult;
  return { message: saved.message, replayed: false };
}

/** Ids das conversas que um membro pode ver, para filtrar avisos em tempo real (SSE) */
export function canSeeEvent(member: Member, assignedUserId: string | null): boolean {
  return canManage(member) || assignedUserId === null || assignedUserId === member.userId;
}
