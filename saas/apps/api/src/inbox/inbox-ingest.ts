import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { INBOX_LIMITS } from '@disparazap/contracts';
import {
  inboxContactIdentities,
  inboxContacts,
  inboxConversationEvents,
  inboxConversations,
  inboxMessages,
  inboxPendingReceipts,
  type AppDatabase,
} from '@disparazap/db';

/**
 * Gravação idempotente dos eventos da Evolution Go na Inbox (HOMOLOGACAO_I0_EVOLUTION §4 e §6.2).
 * - Message com IsFromMe falso: recebida do contato; verdadeiro: enviada pelo celular do número.
 * - SendMessage: eco do que foi enviado pela API (o do painel é reconhecido; o de outro sistema entra como "api").
 * - Receipt: entregue/lida; recibo antes da mensagem fica pendente; ReadSelf zera as não lidas.
 * Repetição não cria nada (índices únicos); a ordem da conversa segue a hora do canal. Conteúdo nunca vai para o log.
 */

export interface AccountRef {
  organizationId: string;
  /** Instância do DisparaZap (app.whatsapp_instances.id) */
  accountId: string;
}

export interface EvolutionEvent {
  event: string;
  data: unknown;
  /** Receipt: Delivered, Read ou ReadSelf (fica fora de data, como no código da Evolution) */
  state?: unknown;
}

export interface Jid {
  jid: string;
  user: string;
  server: string;
}

type Json = Record<string, unknown>;
const asObject = (value: unknown): Json | null => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : null);
const asString = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

/** "5511988887777:12@s.whatsapp.net" → 5511988887777@s.whatsapp.net (sem o número do aparelho) */
export function normalizeJid(value: unknown): Jid | null {
  const text = asString(value);
  if (!text || !text.includes('@')) return null;
  const [rawUser = '', rawServer = ''] = text.split('@');
  const user = rawUser.split(':')[0]?.split('.')[0]?.trim() ?? '';
  const server = rawServer.trim().toLowerCase();
  if (!user || !server || user.length > 64 || server.length > 40) return null;
  return { jid: `${user}@${server}`, user, server };
}

/** Só conversas individuais nesta etapa (grupos, status e canais ficam de fora) */
const isPersonal = (jid: Jid) => jid.server === 's.whatsapp.net' || jid.server === 'lid';
const phoneOf = (jid: Jid | null) => (jid?.server === 's.whatsapp.net' && /^\d{10,15}$/.test(jid.user) ? jid.user : null);
const kindOf = (jid: Jid) => (jid.server === 's.whatsapp.net' ? 'phone' : jid.server === 'lid' ? 'lid' : 'other');

export interface ParsedContent {
  contentType: 'text' | 'media' | 'unsupported';
  text: string | null;
  mediaKind: string | null;
}

const MEDIA_KEYS: Readonly<Record<string, string>> = {
  imageMessage: 'image',
  videoMessage: 'video',
  audioMessage: 'audio',
  documentMessage: 'document',
  documentWithCaptionMessage: 'document',
  stickerMessage: 'sticker',
  ptvMessage: 'video',
};
/** Mensagens de controle do WhatsApp, que não aparecem como mensagem (reação, apagar, chaves, edição) */
const SKIP_KEYS = new Set(['protocolMessage', 'reactionMessage', 'senderKeyDistributionMessage', 'messageContextInfo', 'editedMessage', 'keepInChatMessage', 'pollUpdateMessage', 'encReactionMessage']);

/** Conteúdo do Message (formato do whatsmeow em JSON); null = não é mensagem de conversa */
export function parseContent(message: unknown): ParsedContent | null {
  const body = asObject(message);
  if (!body) return null;
  const conversation = asString(body.conversation);
  if (conversation) return { contentType: 'text', text: conversation, mediaKind: null };
  const extended = asString(asObject(body.extendedTextMessage)?.text);
  if (extended) return { contentType: 'text', text: extended, mediaKind: null };
  for (const [key, kind] of Object.entries(MEDIA_KEYS)) {
    const media = asObject(body[key]);
    if (media) return { contentType: 'media', text: asString(media.caption), mediaKind: kind };
  }
  const keys = Object.keys(body).filter((key) => !['base64', 'mediaUrl', 'mimetype'].includes(key) && body[key] !== null && body[key] !== undefined);
  if (!keys.length || keys.every((key) => SKIP_KEYS.has(key))) return null;
  const first = keys.find((key) => !SKIP_KEYS.has(key)) ?? 'unknown';
  return { contentType: 'unsupported', text: null, mediaKind: first.replace(/Message$/, '').slice(0, 40) };
}

export interface ParsedMessage {
  externalId: string;
  chat: Jid;
  alt: Jid | null;
  fromMe: boolean;
  sentAt: Date;
  pushName: string | null;
  content: ParsedContent;
}

function parseDate(value: unknown): Date | null {
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value > 1e12 ? value : value * 1000);
  const text = asString(value);
  if (!text) return null;
  if (/^\d{9,13}$/.test(text)) return parseDate(Number(text));
  const time = Date.parse(text);
  return Number.isNaN(time) || text.startsWith('0001-') ? null : new Date(time);
}

/** Message e SendMessage: { Info: { Chat, Sender, SenderAlt, IsFromMe, IsGroup, ID, Timestamp, PushName }, Message } */
export function parseMessage(data: unknown, now: Date): ParsedMessage | null {
  const body = asObject(data);
  const info = asObject(body?.Info);
  if (!info) return null;
  const externalId = asString(info.ID);
  const chat = normalizeJid(info.Chat);
  if (!externalId || externalId.length > 128 || !chat || info.IsGroup === true || !isPersonal(chat)) return null;
  const content = parseContent(body?.Message);
  if (!content) return null;
  const altCandidate = normalizeJid(info.SenderAlt) ?? normalizeJid(info.RecipientAlt);
  const alt = altCandidate && isPersonal(altCandidate) && altCandidate.jid !== chat.jid ? altCandidate : null;
  return {
    externalId,
    chat,
    alt,
    fromMe: info.IsFromMe === true,
    sentAt: parseDate(info.Timestamp) ?? now,
    pushName: asString(info.PushName)?.slice(0, 120) ?? null,
    content,
  };
}

export function previewOf(content: { contentType: string; text: string | null; mediaKind: string | null }): string {
  if (content.text) return content.text.replace(/\s+/g, ' ').slice(0, INBOX_LIMITS.previewMax);
  if (content.contentType === 'media') return content.mediaKind === 'audio' ? '[Áudio]' : content.mediaKind === 'image' ? '[Imagem]' : content.mediaKind === 'video' ? '[Vídeo]' : '[Mídia]';
  return '[Mensagem não suportada]';
}

type Tx = Parameters<Parameters<AppDatabase['transaction']>[0]>[0];
type Db = AppDatabase | Tx;

/** Contato pela identidade (número ou LID); cria contato, identidades e conversa quando é a primeira vez */
export async function resolveConversation(db: Db, account: AccountRef, chat: Jid, alt: Jid | null, contactName: string | null): Promise<string> {
  const ids = [chat.jid, ...(alt ? [alt.jid] : [])];
  const known = await db
    .select({ contactId: inboxContactIdentities.contactId })
    .from(inboxContactIdentities)
    .where(and(eq(inboxContactIdentities.accountId, account.accountId), inArray(inboxContactIdentities.externalId, ids)))
    .limit(1);
  let contactId = known[0]?.contactId;
  const phone = phoneOf(chat) ?? phoneOf(alt);
  if (!contactId) {
    contactId = randomUUID();
    await db.insert(inboxContacts).values({ id: contactId, organizationId: account.organizationId, displayName: contactName, phoneE164: phone });
  } else if (contactName || phone) {
    // Nome muda com o tempo (vem do próprio contato); o número só é preenchido se faltava
    await db
      .update(inboxContacts)
      .set({ ...(contactName ? { displayName: contactName } : {}), phoneE164: sql`coalesce(${inboxContacts.phoneE164}, ${phone})`, updatedAt: new Date() })
      .where(and(eq(inboxContacts.organizationId, account.organizationId), eq(inboxContacts.id, contactId)));
  }
  for (const jid of [chat, ...(alt ? [alt] : [])]) {
    await db
      .insert(inboxContactIdentities)
      .values({ organizationId: account.organizationId, accountId: account.accountId, externalId: jid.jid, contactId, kind: kindOf(jid) })
      .onConflictDoNothing();
  }
  const [conversation] = await db
    .select({ id: inboxConversations.id })
    .from(inboxConversations)
    .where(and(eq(inboxConversations.accountId, account.accountId), eq(inboxConversations.contactId, contactId)))
    .limit(1);
  if (conversation) return conversation.id;
  // Prefere o JID por número como identificador da conversa (é por ele que o envio sai)
  const externalId = phoneOf(chat) ? chat.jid : (alt && phoneOf(alt) ? alt.jid : chat.jid);
  const id = randomUUID();
  await db.insert(inboxConversations).values({ id, organizationId: account.organizationId, accountId: account.accountId, contactId, externalId }).onConflictDoNothing();
  const [created] = await db
    .select({ id: inboxConversations.id })
    .from(inboxConversations)
    .where(and(eq(inboxConversations.accountId, account.accountId), eq(inboxConversations.contactId, contactId)))
    .limit(1);
  if (!created) throw new Error('conversa não gravada');
  return created.id;
}

const STATUS_RANK: Readonly<Record<string, number>> = { pending: 0, sent: 1, delivered: 2, read: 3 };

/** Recibo pendente (chegou antes) aplicado à mensagem que acabou de ganhar o id do canal */
export async function applyPendingReceipt(db: Db, account: AccountRef, externalId: string, messageId: string) {
  const [pending] = await db
    .delete(inboxPendingReceipts)
    .where(and(eq(inboxPendingReceipts.accountId, account.accountId), eq(inboxPendingReceipts.externalId, externalId)))
    .returning({ status: inboxPendingReceipts.status });
  if (!pending) return;
  const lower = Object.keys(STATUS_RANK).filter((status) => (STATUS_RANK[status] as number) < (STATUS_RANK[pending.status] as number));
  await db
    .update(inboxMessages)
    .set({ status: pending.status, updatedAt: new Date() })
    .where(and(eq(inboxMessages.organizationId, account.organizationId), eq(inboxMessages.id, messageId), inArray(inboxMessages.status, lower)));
}

/** Última mensagem, prévia e não lidas, sem retroceder se o evento chegou fora de ordem */
export async function touchConversation(db: Db, account: AccountRef, conversationId: string, message: { sentAt: Date; preview: string; direction: 'inbound' | 'outbound' }) {
  const at = message.sentAt.toISOString();
  const newer = sql`(${inboxConversations.lastMessageAt} is null or ${inboxConversations.lastMessageAt} <= ${at}::timestamptz)`;
  const inbound = message.direction === 'inbound';
  const [before] = await db
    .select({ status: inboxConversations.status })
    .from(inboxConversations)
    .where(and(eq(inboxConversations.organizationId, account.organizationId), eq(inboxConversations.id, conversationId)))
    .limit(1);
  await db
    .update(inboxConversations)
    .set({
      lastMessagePreview: sql`case when ${newer} then ${message.preview} else ${inboxConversations.lastMessagePreview} end`,
      lastMessageDirection: sql`case when ${newer} then ${message.direction} else ${inboxConversations.lastMessageDirection} end`,
      lastMessageAt: sql`greatest(coalesce(${inboxConversations.lastMessageAt}, ${at}::timestamptz), ${at}::timestamptz)`,
      ...(inbound
        ? {
            unreadCount: sql`${inboxConversations.unreadCount} + 1`,
            lastInboundAt: sql`greatest(coalesce(${inboxConversations.lastInboundAt}, ${at}::timestamptz), ${at}::timestamptz)`,
            // Mensagem nova do cliente reabre a conversa encerrada
            status: sql`case when ${inboxConversations.status} = 'closed' then 'open' else ${inboxConversations.status} end`,
          }
        : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(inboxConversations.organizationId, account.organizationId), eq(inboxConversations.id, conversationId)));
  if (inbound && before?.status === 'closed') {
    await db.insert(inboxConversationEvents).values({ id: randomUUID(), organizationId: account.organizationId, conversationId, type: 'reopened', data: { motivo: 'nova_mensagem' } });
  }
}

async function ingestMessage(db: AppDatabase, account: AccountRef, parsed: ParsedMessage, echo: boolean): Promise<string[]> {
  return db.transaction(async (tx) => {
    const inbound = !parsed.fromMe;
    const conversationId = await resolveConversation(tx, account, parsed.chat, parsed.alt, inbound ? parsed.pushName : null);
    const [existing] = await tx
      .select({ id: inboxMessages.id })
      .from(inboxMessages)
      .where(and(eq(inboxMessages.conversationId, conversationId), eq(inboxMessages.externalId, parsed.externalId)))
      .limit(1);
    if (existing) return [];

    if (echo && parsed.content.text) {
      // Eco de um envio do painel que ainda não recebeu o id: casa com o pendente mais antigo de mesmo texto
      const [pending] = await tx
        .select({ id: inboxMessages.id })
        .from(inboxMessages)
        .where(
          and(
            eq(inboxMessages.conversationId, conversationId),
            isNull(inboxMessages.externalId),
            eq(inboxMessages.author, 'user'),
            eq(inboxMessages.status, 'pending'),
            eq(inboxMessages.body, parsed.content.text),
          ),
        )
        .orderBy(asc(inboxMessages.createdAt))
        .limit(1);
      if (pending) {
        await tx.update(inboxMessages).set({ externalId: parsed.externalId, status: 'sent', updatedAt: new Date() }).where(eq(inboxMessages.id, pending.id));
        await applyPendingReceipt(tx, account, parsed.externalId, pending.id);
        return [conversationId];
      }
    }

    const id = randomUUID();
    const inserted = await tx
      .insert(inboxMessages)
      .values({
        id,
        organizationId: account.organizationId,
        conversationId,
        direction: inbound ? 'inbound' : 'outbound',
        author: inbound ? 'contact' : echo ? 'api' : 'phone',
        externalId: parsed.externalId,
        contentType: parsed.content.contentType,
        mediaKind: parsed.content.mediaKind,
        body: parsed.content.text,
        status: inbound ? 'received' : 'sent',
        sentAt: parsed.sentAt,
      })
      .onConflictDoNothing()
      .returning({ id: inboxMessages.id });
    if (!inserted.length) return [];
    if (!inbound) await applyPendingReceipt(tx, account, parsed.externalId, id);
    await touchConversation(tx, account, conversationId, { sentAt: parsed.sentAt, preview: previewOf(parsed.content), direction: inbound ? 'inbound' : 'outbound' });
    return [conversationId];
  });
}

/** Receipt: { MessageIDs, Chat, … } com state Delivered | Read | ReadSelf */
async function ingestReceipt(db: AppDatabase, account: AccountRef, event: EvolutionEvent): Promise<string[]> {
  const data = asObject(event.data);
  const state = asString(event.state);
  const chat = normalizeJid(data?.Chat);
  const ids = (Array.isArray(data?.MessageIDs) ? data.MessageIDs : []).map(asString).filter((id): id is string => Boolean(id && id.length <= 128)).slice(0, 200);
  if (!chat || !isPersonal(chat)) return [];

  if (state === 'ReadSelf') {
    // Lida no próprio celular: zera as não lidas da conversa
    const [identity] = await db
      .select({ contactId: inboxContactIdentities.contactId })
      .from(inboxContactIdentities)
      .where(and(eq(inboxContactIdentities.accountId, account.accountId), eq(inboxContactIdentities.externalId, chat.jid)))
      .limit(1);
    if (!identity) return [];
    const updated = await db
      .update(inboxConversations)
      .set({ unreadCount: 0, updatedAt: new Date() })
      .where(and(eq(inboxConversations.accountId, account.accountId), eq(inboxConversations.contactId, identity.contactId)))
      .returning({ id: inboxConversations.id });
    return updated.map((row) => row.id);
  }

  const status = state === 'Read' ? 'read' : state === 'Delivered' ? 'delivered' : null;
  if (!status || !ids.length) return [];
  const lower = Object.keys(STATUS_RANK).filter((item) => (STATUS_RANK[item] as number) < (STATUS_RANK[status] as number));
  const changed = new Set<string>();
  await db.transaction(async (tx) => {
    for (const externalId of ids) {
      const conversations = tx.select({ id: inboxConversations.id }).from(inboxConversations).where(eq(inboxConversations.accountId, account.accountId));
      const found = await tx
        .select({ id: inboxMessages.id, conversationId: inboxMessages.conversationId, status: inboxMessages.status })
        .from(inboxMessages)
        .where(and(eq(inboxMessages.organizationId, account.organizationId), eq(inboxMessages.externalId, externalId), inArray(inboxMessages.conversationId, conversations)))
        .limit(1);
      const message = found[0];
      if (!message) {
        // Recibo antes da mensagem (eventos fora de ordem): guarda o maior estado até ela chegar
        await tx
          .insert(inboxPendingReceipts)
          .values({ accountId: account.accountId, externalId, organizationId: account.organizationId, status })
          .onConflictDoUpdate({
            target: [inboxPendingReceipts.accountId, inboxPendingReceipts.externalId],
            set: { status: sql`case when excluded.status = 'read' then 'read' else ${inboxPendingReceipts.status} end` },
          });
        continue;
      }
      if (!lower.includes(message.status)) continue;
      await tx.update(inboxMessages).set({ status, updatedAt: new Date() }).where(eq(inboxMessages.id, message.id));
      changed.add(message.conversationId);
    }
  });
  return [...changed];
}

/** Um evento da Evolution de uma conta autorizada; devolve as conversas alteradas (para avisar o painel) */
export async function ingestEvolutionEvent(db: AppDatabase, account: AccountRef, event: EvolutionEvent, now = new Date()): Promise<string[]> {
  if (event.event === 'Message' || event.event === 'SendMessage') {
    const parsed = parseMessage(event.data, now);
    if (!parsed) return [];
    // SendMessage é sempre "meu", mesmo se o campo vier faltando
    return ingestMessage(db, account, event.event === 'SendMessage' ? { ...parsed, fromMe: true } : parsed, event.event === 'SendMessage');
  }
  if (event.event === 'Receipt') return ingestReceipt(db, account, event);
  return [];
}
