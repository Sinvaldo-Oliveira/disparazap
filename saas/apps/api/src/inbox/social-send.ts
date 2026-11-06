import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { SOCIAL_REPLY_TEXT_MAX, socialReplyWindow, type SocialSendResult } from '@disparazap/contracts';
import { withTenant, type AppDatabase } from '@disparazap/db';
import { canOperate, type Member } from '../auth/member.ts';
import { ZernioError, type ZernioInboxMessageRaw } from '../integrations/zernio-client.ts';
import type { ZernioContext } from '../zernio/zernio-service.ts';
import { InboxError } from './inbox-service.ts';
import { accountOf, runRead, scope } from './social-inbox.ts';

/**
 * Envio de respostas humanas pelo Instagram (Z3.2). Regras:
 * - só uma pessoa envia (origem "humano", validada pela rota e pela sessão); IA e automações não passam daqui;
 * - a janela é revalidada com histórico lido na hora; sem histórico confirmado ou sem data confiável, bloqueia;
 * - cada intenção tem um requestId: o registro é gravado ANTES da chamada e nunca é reenviado sozinho;
 * - falha sem envio (4xx definitivos) marca "failed"; resultado incerto (409 em processamento, 5xx, tempo esgotado,
 *   resposta sem id) marca "unknown" e não é reenviado automaticamente;
 * - o texto nunca vai para o log nem para o registro: só o tamanho.
 */

export type SendState = 'pending' | 'sent' | 'failed' | 'unknown';
export interface SendRecord {
  status: SendState;
  providerMessageId: string | null;
  errorCategory: string | null;
}
export type SendReservation = { created: true } | { created: false; existing: SendRecord };

/** Registro local de envios (tabela app.inbox_social_sends, migração 0008, ainda não aplicada) */
export interface SendRegistry {
  reserve(organizationId: string, requestId: string, data: { accountRef: string; conversationRef: string; actorUserId: string; textLength: number; windowMode: 'none' | 'human_agent' }): Promise<SendReservation>;
  finish(organizationId: string, requestId: string, record: SendRecord): Promise<void>;
}

const rowsOf = (result: unknown) => (result as { rows?: Record<string, unknown>[] }).rows ?? [];

/** Implementação sobre o banco, sempre dentro do contexto da empresa (RLS) */
export function dbSendRegistry(db: AppDatabase): SendRegistry {
  return {
    async reserve(organizationId, requestId, data) {
      return withTenant(db, organizationId, async (tx) => {
        const inserted = await tx.execute(sql`insert into app.inbox_social_sends (id, organization_id, account_ref, conversation_ref, client_request_id, actor_user_id, text_length, window_mode, status) values (${randomUUID()}, ${organizationId}, ${data.accountRef}, ${data.conversationRef}, ${requestId}, ${data.actorUserId}, ${data.textLength}, ${data.windowMode}, 'pending') on conflict (organization_id, client_request_id) do nothing returning id`);
        if (rowsOf(inserted).length > 0) return { created: true };
        const found = await tx.execute(sql`select status, provider_message_id, error_category from app.inbox_social_sends where client_request_id = ${requestId} limit 1`);
        const row = rowsOf(found)[0];
        return {
          created: false,
          existing: { status: String(row?.status) as SendState, providerMessageId: (row?.provider_message_id as string | null) ?? null, errorCategory: (row?.error_category as string | null) ?? null },
        };
      });
    },
    async finish(organizationId, requestId, record) {
      await withTenant(db, organizationId, (tx) =>
        tx.execute(sql`update app.inbox_social_sends set status = ${record.status}, provider_message_id = ${record.providerMessageId}, error_category = ${record.errorCategory}, attempts = attempts + 1, updated_at = now() where client_request_id = ${requestId}`),
      );
    },
  };
}

/** Classificação defensiva: só o que a documentação diz não ter enviado vira "failed"; o resto fica "unknown" */
export function classifySendError(err: ZernioError): { status: 'failed' | 'unknown'; category: string } {
  switch (err.kind) {
    case 'unauthorized':
      return { status: 'failed', category: 'auth' };
    case 'invalid':
      return { status: 'failed', category: 'invalid' };
    case 'rate_limited':
      return { status: 'failed', category: 'rate_limited' };
    case 'forbidden':
    case 'payment_required':
    case 'platform_unavailable':
      return { status: 'failed', category: 'platform_rejected' };
    case 'not_found':
      return { status: 'failed', category: 'not_found' };
    case 'conflict':
      return { status: 'unknown', category: 'in_progress' };
    case 'unreachable':
      return { status: 'unknown', category: 'timeout' };
    default:
      return { status: 'unknown', category: 'upstream' };
  }
}

const MESSAGES: Readonly<Record<SendState, string>> = {
  sent: 'Mensagem enviada ao Instagram.',
  pending: 'Este envio ainda está em andamento. Aguarde antes de tentar de novo.',
  failed: 'O Instagram não aceitou esta mensagem. Você pode escrever outra resposta.',
  unknown: 'Ainda não sabemos se a mensagem chegou. Confira a conversa antes de enviar outra resposta.',
};

const replayed = (record: SendRecord): SocialSendResult => ({ status: record.status, replayed: true, providerMessageId: record.providerMessageId, message: MESSAGES[record.status] });

const isoOrNull = (value: string | null): string | null => {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
};

/** Última mensagem do contato (direction incoming), pelo horário de envio ou, se faltar, pelo de criação */
function latestIncoming(items: ZernioInboxMessageRaw[]): string | null {
  let latest: string | null = null;
  for (const item of items) {
    if (item.direction !== 'incoming') continue;
    const at = isoOrNull(item.sentAt ?? item.createdAt);
    if (at && (!latest || at > latest)) latest = at;
  }
  return latest;
}

export interface SocialSendRequest {
  conversationId: string;
  accountId: string;
  requestId: string;
  text: string;
  /** Só "humano": IA, automações e campanhas não passam por este serviço */
  origin: 'humano';
}

export interface SocialSendDeps {
  enabled: boolean;
  registry: SendRegistry;
  nowMs?: () => number;
}

export async function sendSocialReply(ctx: ZernioContext, member: Member, request: SocialSendRequest, deps: SocialSendDeps): Promise<SocialSendResult> {
  if (request.origin !== 'humano') throw new InboxError(403, 'Só uma pessoa pode responder pelo Instagram.');
  if (!canOperate(member)) throw new InboxError(403, 'A Inbox é usada pelo dono, pelos administradores e pelos atendentes da empresa.');
  if (!deps.enabled) throw new InboxError(409, 'O envio pelo Instagram ainda não está habilitado nesta plataforma.');
  const text = request.text.trim();
  const length = [...text].length;
  if (length === 0) throw new InboxError(400, 'Escreva a mensagem.');
  if (length > SOCIAL_REPLY_TEXT_MAX) throw new InboxError(400, `Use no máximo ${SOCIAL_REPLY_TEXT_MAX} caracteres.`);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(request.requestId)) throw new InboxError(400, 'Pedido inválido. Recarregue a página.');
  if (!request.conversationId || request.conversationId.length > 300) throw new InboxError(404, 'Conversa não encontrada nesta conta.');

  const { client, accounts } = await scope(ctx, member);
  const account = accountOf(accounts, request.accountId);

  // Janela revalidada agora, com histórico lido na hora (nunca com a tela antiga)
  const page = await runRead(() => client.listInboxMessages({ conversationId: request.conversationId, accountId: account.id, cursor: null, limit: 50, sortOrder: 'desc' }));
  const historyReliable = page.sortOrderApplied === 'desc';
  const window = socialReplyWindow(latestIncoming(page.items), historyReliable, (deps.nowMs ?? Date.now)());
  if (window.mode === 'blocked') throw new InboxError(409, window.label);
  const windowMode = window.mode === 'human_agent' ? 'human_agent' : 'none';

  // Registro antes da chamada: a mesma intenção nunca chega duas vezes à Zernio
  const reservation = await deps.registry.reserve(member.organizationId, request.requestId, {
    accountRef: account.id,
    conversationRef: request.conversationId,
    actorUserId: member.userId,
    textLength: length,
    windowMode,
  });
  if (!reservation.created) return replayed(reservation.existing);

  // Tags só nos campos documentados; resposta fora da janela de 24 h usa HUMAN_AGENT (só humano, até 7 dias)
  const tags = windowMode === 'human_agent' ? { messageTag: 'HUMAN_AGENT' as const, messagingType: 'MESSAGE_TAG' as const } : {};
  let record: SendRecord;
  try {
    const sent = await client.sendInboxMessage(request.conversationId, { accountId: account.id, message: text, ...tags }, request.requestId);
    record = sent.messageId
      ? { status: 'sent', providerMessageId: sent.messageId, errorCategory: null }
      : { status: 'unknown', providerMessageId: null, errorCategory: 'no_message_id' };
  } catch (err) {
    if (!(err instanceof ZernioError)) {
      await deps.registry.finish(member.organizationId, request.requestId, { status: 'unknown', providerMessageId: null, errorCategory: 'unexpected' }).catch(() => undefined);
      throw err;
    }
    const mapped = classifySendError(err);
    record = { status: mapped.status, providerMessageId: null, errorCategory: mapped.category };
  }
  await deps.registry.finish(member.organizationId, request.requestId, record);
  return { status: record.status, replayed: false, providerMessageId: record.providerMessageId, message: MESSAGES[record.status] };
}
