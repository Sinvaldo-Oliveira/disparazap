import {
  SOCIAL_DATE_DIAGNOSTIC_LIMIT,
  SOCIAL_INBOX_PAGE_SIZE,
  type SocialDateDiagnostic,
  type SocialInboxConversation,
  type SocialInboxConversationsResponse,
  type SocialInboxMessage,
  type SocialInboxMessagesResponse,
} from '@disparazap/contracts';
import type { Member } from '../auth/member.ts';
import { canManage, canOperate } from '../auth/member.ts';
import { ZernioError, type ZernioInboxConversationRaw, type ZernioInboxMessageRaw } from '../integrations/zernio-client.ts';
import { readAccounts, readyClient, ZernioServiceError, type ZernioContext } from '../zernio/zernio-service.ts';
import { InboxError } from './inbox-service.ts';

/**
 * Leitura das conversas de redes sociais na Inbox (Z2, PLANO_MODULO_INBOX). Lê direto da Zernio, a cada pedido: nada é
 * gravado no banco nem registrado no log (o conteúdo das mensagens não sai daqui). Tudo passa pelas contas do perfil da
 * empresa: uma conta de outra empresa responde 404, como se não existisse. Só leitura: não há envio nesta etapa.
 */
const PLATFORM = 'instagram';
/** Redes cuja LISTA de conversas é lida (TikTok, autorizado em 2026-11-05). Mensagens, diagnóstico e envio continuam só no Instagram */
const LIST_PLATFORMS: readonly string[] = [PLATFORM, 'tiktok'];
const READ_ERRORS = {
  unauthorized: 'A Zernio recusou a chave guardada. Cadastre uma chave nova em "Trocar chave".',
  unavailable: 'A Zernio não liberou a Inbox desta conta (plano, complemento ou permissão). Confira no painel da Zernio.',
  rate_limited: 'A Zernio pediu uma pausa por excesso de pedidos. Tente de novo em instantes.',
  rejected: 'A Zernio não aceitou o pedido. Atualize a página e tente de novo.',
  unexpected: 'A Zernio respondeu de um jeito não previsto. Tente de novo em instantes.',
} as const;

/** Traduz falhas da Zernio em mensagens fixas: nada do texto da Zernio chega à tela */
export function readFailure(err: unknown): never {
  if (err instanceof InboxError) throw err;
  if (err instanceof ZernioServiceError) throw new InboxError(err.status, err.message);
  if (err instanceof ZernioError) {
    switch (err.kind) {
      case 'unauthorized':
        throw new InboxError(409, READ_ERRORS.unauthorized);
      case 'forbidden':
      case 'payment_required':
      case 'platform_unavailable':
        throw new InboxError(403, READ_ERRORS.unavailable);
      case 'rate_limited':
        throw new InboxError(429, READ_ERRORS.rate_limited);
      case 'not_found':
        throw new InboxError(404, 'Conversa não encontrada nesta conta.');
      case 'invalid':
        throw new InboxError(400, READ_ERRORS.rejected);
      default:
        throw new InboxError(502, READ_ERRORS.unexpected);
    }
  }
  throw err;
}

function requireReader(member: Member) {
  if (!canOperate(member)) throw new InboxError(403, 'A Inbox é usada pelo dono, pelos administradores e pelos atendentes da empresa.');
}

const isoOrNull = (value: string | null): string | null => {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
};

/** Carrega o cliente da Zernio e as contas do perfil desta empresa (as únicas que podem aparecer) */
export async function scope(ctx: ZernioContext, member: Member) {
  try {
    const { row, client } = await readyClient(ctx, member);
    const accounts = await readAccounts(client, row);
    return { row, client, accounts };
  } catch (err) {
    return readFailure(err);
  }
}

export async function runRead<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    return readFailure(err);
  }
}

/** Conta pedida: tem de ser do perfil da empresa e do Instagram nesta etapa (senão, 404 ou 400) */
export function accountOf(accounts: { id: string; platform: string; username: string | null; displayName: string | null }[], accountId: string, allowed: readonly string[] = [PLATFORM]) {
  const account = accounts.find((item) => item.id === accountId);
  if (!account) throw new InboxError(404, 'Conta não encontrada nesta empresa.');
  if (!allowed.includes(account.platform)) throw new InboxError(400, allowed.length > 1 ? 'Esta etapa lê conversas só do Instagram e do TikTok.' : 'Esta etapa lê só conversas do Instagram.');
  return account;
}

export async function listSocialConversations(
  ctx: ZernioContext,
  member: Member,
  query: { accountId: string; cursor?: string | undefined },
): Promise<SocialInboxConversationsResponse> {
  requireReader(member);
  const { row, client, accounts } = await scope(ctx, member);
  const account = accountOf(accounts, query.accountId, LIST_PLATFORMS);
  const page = await runRead(() => client.listInboxConversations({ profileId: row.profileId, accountId: account.id, platform: account.platform, cursor: query.cursor ?? null, limit: SOCIAL_INBOX_PAGE_SIZE }));
  // DIAGNÓSTICO TEMPORÁRIO (TikTok, 2026-11-05): só contagens e valores de campos, nunca texto, nome ou número. Remover depois da homologação
  if (process.env.NODE_ENV !== 'production') {
    console.info('[diagnostico-inbox]', JSON.stringify({
      rede: account.platform,
      retornadas: page.items.length,
      redes: [...new Set(page.items.map((item) => item.platform))],
      contaIgual: page.items.filter((item) => item.accountId === account.id).length,
      contaDiferente: page.items.filter((item) => item.accountId !== null && item.accountId !== account.id).length,
      contaVazia: page.items.filter((item) => item.accountId === null).length,
      ultimaMensagemPreenchida: page.items.filter((item) => item.lastMessage !== null).length,
    }));
  }
  const names = new Map(accounts.map((item) => [item.id, item.username ? `@${item.username}` : item.displayName]));
  // Só conversas que dizem ser do Instagram e da conta pedida. O que não bate é descartado, sem substituir o identificador
  const conversations: SocialInboxConversation[] = page.items
    .filter((item: ZernioInboxConversationRaw) => item.platform === account.platform && item.accountId === account.id)
    .map((item: ZernioInboxConversationRaw) => ({
      id: item.id,
      platform: account.platform,
      accountId: account.id,
      accountName: names.get(account.id) ?? null,
      contactName: item.participantName,
      lastMessage: item.lastMessage,
      updatedAt: isoOrNull(item.updatedTime),
      archived: item.status === 'archived',
      unreadCount: item.unreadCount,
    }));
  return { conversations, hasMore: page.hasMore, nextCursor: page.nextCursor };
}

export async function listSocialMessages(
  ctx: ZernioContext,
  member: Member,
  conversationId: string,
  query: { accountId: string; cursor?: string | undefined },
): Promise<SocialInboxMessagesResponse> {
  requireReader(member);
  if (!conversationId || conversationId.length > 300) throw new InboxError(404, 'Conversa não encontrada nesta conta.');
  const { client, accounts } = await scope(ctx, member);
  const account = accountOf(accounts, query.accountId);
  const page = await runRead(() => client.listInboxMessages({ conversationId, accountId: account.id, cursor: query.cursor ?? null, limit: SOCIAL_INBOX_PAGE_SIZE, sortOrder: 'desc' }));
  // Horário de envio (sentAt) quando a Zernio informa; senão createdAt. A ordem da tela segue esse horário,
  // não a ordem em que a Zernio devolveu a página (que pode não ser a de envio)
  const messages: SocialInboxMessage[] = page.items
    .map((item: ZernioInboxMessageRaw) => ({ id: item.id, direction: item.direction, text: item.message, attachmentTypes: item.attachmentTypes as SocialInboxMessage['attachmentTypes'], sentAt: isoOrNull(item.sentAt ?? item.createdAt) }))
    .sort((x, y) => (Date.parse(x.sentAt ?? '') || 0) - (Date.parse(y.sentAt ?? '') || 0));
  const sortOrderApplied = page.sortOrderApplied === 'asc' || page.sortOrderApplied === 'desc' ? page.sortOrderApplied : null;
  // Sem confirmação da Zernio de que a página é a mais recente, o histórico não é confiável (não serve para a janela)
  return { messages, hasMore: page.hasMore, nextCursor: page.nextCursor, sortOrderApplied, historyReliable: sortOrderApplied === 'desc' };
}


/**
 * Diagnóstico temporário das datas (Z2.4): lê UMA conversa, no máximo 10 mensagens, e devolve só datas, campos presentes,
 * tipos de anexo e a ordem. Nunca devolve o texto. Só dono e administradores. Removível depois da homologação.
 */
export async function diagnoseSocialDates(ctx: ZernioContext, member: Member, conversationId: string, accountId: string): Promise<SocialDateDiagnostic> {
  if (!canManage(member)) throw new InboxError(403, 'Só o dono e os administradores fazem o diagnóstico de datas.');
  if (!conversationId || conversationId.length > 300) throw new InboxError(404, 'Conversa não encontrada nesta conta.');
  const { client, accounts } = await scope(ctx, member);
  const account = accountOf(accounts, accountId);
  const page = await runRead(() => client.listInboxMessages({ conversationId, accountId: account.id, cursor: null, limit: SOCIAL_DATE_DIAGNOSTIC_LIMIT, sortOrder: 'desc' }));
  const items: ZernioInboxMessageRaw[] = page.items;
  const millis = (value: string | null) => (value ? Date.parse(value) : Number.NaN);
  const byKey = (key: 'sentAt' | 'createdAt') => [...items].sort((x, y) => (millis(y[key]) || 0) - (millis(x[key]) || 0)).map((item) => item.id);
  const serverIds = items.map((item) => item.id);
  const matches = (key: 'sentAt' | 'createdAt') => byKey(key).every((id, index) => id === serverIds[index]);
  const pick = (item: ZernioInboxMessageRaw | undefined) => (item ? { sentAt: isoOrNull(item.sentAt), createdAt: isoOrNull(item.createdAt) } : null);
  const firstIncoming = items.find((item) => item.direction === 'incoming');
  return {
    readCount: items.length,
    hasMore: page.hasMore,
    sortOrderApplied: page.sortOrderApplied === 'asc' || page.sortOrderApplied === 'desc' ? page.sortOrderApplied : null,
    messages: items.map((item) => ({
      direction: item.direction,
      hasText: Boolean(item.message && item.message.trim()),
      attachmentTypes: item.attachmentTypes as SocialDateDiagnostic['messages'][number]['attachmentTypes'],
      sentAt: isoOrNull(item.sentAt),
      createdAt: isoOrNull(item.createdAt),
      sentMinusCreatedSeconds: item.sentAt && item.createdAt ? (Date.parse(item.sentAt) - Date.parse(item.createdAt)) / 1000 : null,
    })),
    orderMatchesSentAt: matches('sentAt'),
    orderMatchesCreatedAt: matches('createdAt'),
    lastIncoming: pick(firstIncoming),
    newest: pick(items[0]),
  };
}
