import { z } from 'zod';
import { INTERNAL_API_PREFIX } from './auth.ts';

// Inbox multicanal (saas/docs/PLANO_MODULO_INBOX.md, etapa I1): conversas de WhatsApp recebidas da Evolution Go por WebSocket.
// Instagram, Facebook, mídias, IA e automações vêm nas próximas etapas; os campos de controle já ficam prontos.

export const INBOX_PATH = `${INTERNAL_API_PREFIX}/inbox`;
export const INBOX_CHANNELS_PATH = `${INBOX_PATH}/channels`;
export const inboxActivationPath = (accountId: string) => `${INBOX_CHANNELS_PATH}/${encodeURIComponent(accountId)}/activate`;
export const INBOX_CONVERSATIONS_PATH = `${INBOX_PATH}/conversations`;
export const inboxConversationPath = (id: string) => `${INBOX_CONVERSATIONS_PATH}/${encodeURIComponent(id)}`;
export const inboxMessagesPath = (id: string) => `${inboxConversationPath(id)}/messages`;
export const inboxReadPath = (id: string) => `${inboxConversationPath(id)}/read`;
export const INBOX_STREAM_PATH = `${INBOX_PATH}/stream`;

/** Rotas do painel */
export const INBOX_ROUTE = '/inbox';
export const inboxConversationRoute = (id: string) => `${INBOX_ROUTE}/${encodeURIComponent(id)}`;
export const inboxDetailsRoute = (id: string) => `${inboxConversationRoute(id)}/detalhes`;

export const INBOX_CHANNEL_TYPES = ['whatsapp'] as const;
export type InboxChannelType = (typeof INBOX_CHANNEL_TYPES)[number];

/**
 * Quem responde a conversa agora (plano §E.5). Toda troca aumenta a `controlVersion`: uma resposta automática (IA ou
 * automação) só sai se o modo e a versão ainda forem os mesmos de quando ela foi gerada.
 */
export const INBOX_CONTROL_MODES = ['human', 'ai', 'automation', 'waiting_human', 'closed'] as const;
export type InboxControlMode = (typeof INBOX_CONTROL_MODES)[number];
export const INBOX_CONTROL_LABELS: Readonly<Record<InboxControlMode, string>> = {
  human: 'Atendimento humano',
  ai: 'Agente de IA',
  automation: 'Automação',
  waiting_human: 'Aguardando atendente',
  closed: 'Encerrada',
};

export const INBOX_CONVERSATION_STATUSES = ['open', 'pending', 'closed'] as const;
export type InboxConversationStatus = (typeof INBOX_CONVERSATION_STATUSES)[number];

export const INBOX_DIRECTIONS = ['inbound', 'outbound'] as const;
/** contact = o cliente; user = atendente pelo painel; phone = enviado pelo celular do número; api = outro sistema pela API */
export const INBOX_AUTHORS = ['contact', 'user', 'phone', 'api', 'ai', 'automation', 'system'] as const;
export type InboxAuthor = (typeof INBOX_AUTHORS)[number];
export const INBOX_MESSAGE_STATUSES = ['received', 'pending', 'sent', 'delivered', 'read', 'failed'] as const;
export type InboxMessageStatus = (typeof INBOX_MESSAGE_STATUSES)[number];
export const INBOX_CONTENT_TYPES = ['text', 'media', 'unsupported'] as const;

export const INBOX_LIMITS = {
  textMax: 4096,
  searchMax: 100,
  pageSize: 50,
  messagesPage: 100,
  previewMax: 120,
} as const;

// ----- Canais e recebimento -----

export const INBOX_RECEPTION_STATES = ['disabled', 'unavailable', 'connecting', 'connected', 'reconnecting', 'auth_failed'] as const;
export type InboxReceptionState = (typeof INBOX_RECEPTION_STATES)[number];

export const inboxChannelSchema = z.strictObject({
  /** Instância de WhatsApp da empresa (id do DisparaZap) */
  id: z.string(),
  type: z.enum(INBOX_CHANNEL_TYPES),
  name: z.string(),
  phone: z.string().nullable(),
  connected: z.boolean(),
  /** Recebimento ligado na Inbox (null = desligado) */
  inboxEnabledAt: z.iso.datetime().nullable(),
  unreadCount: z.number().int().nonnegative(),
});
export type InboxChannel = z.infer<typeof inboxChannelSchema>;

export const inboxGapSchema = z.strictObject({
  accountId: z.string(),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
});
export type InboxGap = z.infer<typeof inboxGapSchema>;

export const inboxChannelsResponseSchema = z.strictObject({
  channels: z.array(inboxChannelSchema),
  reception: z.strictObject({ state: z.enum(INBOX_RECEPTION_STATES), since: z.iso.datetime().nullable() }),
  /** Períodos sem recebimento recentes (as mensagens desse intervalo podem não aparecer) */
  gaps: z.array(inboxGapSchema),
  /** Ligar o recebimento nas instâncias: bloqueado até a homologação (HOMOLOGACAO_I0_EVOLUTION, P3 e P4) */
  activationAvailable: z.boolean(),
  canManage: z.boolean(),
});
export type InboxChannelsResponse = z.infer<typeof inboxChannelsResponseSchema>;

// ----- Conversas e mensagens -----

export const inboxConversationSchema = z.strictObject({
  id: z.string(),
  channel: z.enum(INBOX_CHANNEL_TYPES),
  accountId: z.string(),
  accountName: z.string(),
  contact: z.strictObject({ id: z.string(), name: z.string().nullable(), phone: z.string().nullable() }),
  status: z.enum(INBOX_CONVERSATION_STATUSES),
  controlMode: z.enum(INBOX_CONTROL_MODES),
  controlVersion: z.number().int().nonnegative(),
  assignedTo: z.strictObject({ id: z.string(), name: z.string() }).nullable(),
  unreadCount: z.number().int().nonnegative(),
  lastMessageAt: z.iso.datetime().nullable(),
  lastMessagePreview: z.string().nullable(),
  lastMessageDirection: z.enum(INBOX_DIRECTIONS).nullable(),
});
export type InboxConversation = z.infer<typeof inboxConversationSchema>;

export const inboxMessageSchema = z.strictObject({
  id: z.string(),
  direction: z.enum(INBOX_DIRECTIONS),
  author: z.enum(INBOX_AUTHORS),
  /** Nome de quem enviou pelo painel (só author = user) */
  authorName: z.string().nullable(),
  contentType: z.enum(INBOX_CONTENT_TYPES),
  /** image, video, audio, document, sticker… (mídias chegam na próxima etapa) */
  mediaKind: z.string().nullable(),
  text: z.string().nullable(),
  status: z.enum(INBOX_MESSAGE_STATUSES),
  /** Motivo fixo da falha de envio, pronto para a tela */
  error: z.string().nullable(),
  sentAt: z.iso.datetime(),
});
export type InboxMessage = z.infer<typeof inboxMessageSchema>;

export const inboxConversationsQuerySchema = z.strictObject({
  channel: z.enum(INBOX_CHANNEL_TYPES).optional(),
  accountId: z.string().max(100).optional(),
  search: z.string().trim().max(INBOX_LIMITS.searchMax).optional(),
  filter: z.enum(['all', 'unread', 'open', 'closed']).default('all'),
  /** Data/hora da última mensagem do último item da página anterior */
  before: z.iso.datetime().optional(),
});
export type InboxConversationsQuery = z.input<typeof inboxConversationsQuerySchema>;

export const inboxConversationsResponseSchema = z.strictObject({
  conversations: z.array(inboxConversationSchema),
  hasMore: z.boolean(),
  canSend: z.boolean(),
});
export type InboxConversationsResponse = z.infer<typeof inboxConversationsResponseSchema>;

export const inboxConversationDetailSchema = z.strictObject({
  conversation: inboxConversationSchema,
  messages: z.array(inboxMessageSchema),
  hasMore: z.boolean(),
  canSend: z.boolean(),
});
export type InboxConversationDetail = z.infer<typeof inboxConversationDetailSchema>;

export const inboxSendInputSchema = z.strictObject({
  /** Gerado pelo painel: repetir o mesmo pedido nunca envia duas vezes */
  requestId: z.uuid('Pedido inválido. Recarregue a página.'),
  text: z.string().trim().min(1, 'Escreva a mensagem.').max(INBOX_LIMITS.textMax, `Use no máximo ${INBOX_LIMITS.textMax} caracteres.`),
});
export type InboxSendInput = z.input<typeof inboxSendInputSchema>;

export const inboxSendResultSchema = z.strictObject({
  message: inboxMessageSchema,
  /** O mesmo pedido já tinha sido feito: nada foi enviado de novo */
  replayed: z.boolean(),
});
export type InboxSendResult = z.infer<typeof inboxSendResultSchema>;

/** Evento do canal em tempo real (SSE): só avisa o que mudou; o painel relê pela API */
export const inboxStreamEventSchema = z.strictObject({
  type: z.enum(['ready', 'conversation', 'reception']),
  conversationId: z.string().nullable(),
});
export type InboxStreamEvent = z.infer<typeof inboxStreamEventSchema>;

// ----- Redes sociais na Inbox (Z2, 2026-11-04): leitura direta da Zernio, sem gravar nada no banco -----
// Verificado em docs.zernio.com: GET /v1/inbox/conversations (lista, com profileId opcional) e
// GET /v1/inbox/conversations/{conversationId}/messages (accountId obrigatório; direction incoming/outgoing; texto em "message").

export const INBOX_SOCIAL_CONVERSATIONS_PATH = `${INBOX_PATH}/social/conversations`;
export const socialInboxMessagesPath = (conversationId: string) => `${INBOX_SOCIAL_CONVERSATIONS_PATH}/${encodeURIComponent(conversationId)}/messages`;

/** Mais recentes primeiro na página; o painel inverte para mostrar em ordem cronológica */
export const SOCIAL_INBOX_PAGE_SIZE = 50;

export const socialInboxConversationsQuerySchema = z.strictObject({
  accountId: z.string().min(1).max(100),
  cursor: z.string().min(1).max(500).optional(),
});
export type SocialInboxConversationsQuery = z.input<typeof socialInboxConversationsQuerySchema>;

export const socialInboxConversationSchema = z.strictObject({
  id: z.string(),
  platform: z.string(),
  accountId: z.string(),
  accountName: z.string().nullable(),
  contactName: z.string().nullable(),
  lastMessage: z.string().nullable(),
  updatedAt: z.iso.datetime().nullable(),
  archived: z.boolean(),
  unreadCount: z.number().int().nonnegative().nullable(),
});
export type SocialInboxConversation = z.infer<typeof socialInboxConversationSchema>;

export const socialInboxConversationsResponseSchema = z.strictObject({
  conversations: z.array(socialInboxConversationSchema),
  hasMore: z.boolean(),
  nextCursor: z.string().nullable(),
});
export type SocialInboxConversationsResponse = z.infer<typeof socialInboxConversationsResponseSchema>;

export const socialInboxMessagesQuerySchema = z.strictObject({
  accountId: z.string().min(1).max(100),
  cursor: z.string().min(1).max(500).optional(),
});
export type SocialInboxMessagesQuery = z.input<typeof socialInboxMessagesQuerySchema>;

/** Tipos de anexo que a Zernio documenta; qualquer outro vira "unsupported_type" */
export const SOCIAL_ATTACHMENT_TYPES = ['image', 'video', 'audio', 'file', 'sticker', 'share', 'template', 'unsupported_type'] as const;
export type SocialAttachmentType = (typeof SOCIAL_ATTACHMENT_TYPES)[number];

export const socialInboxMessageSchema = z.strictObject({
  id: z.string(),
  /** incoming = o contato escreveu; outgoing = a empresa (pelo painel, pela Zernio ou pelo app da rede) */
  direction: z.enum(['incoming', 'outgoing']),
  /** Texto da mensagem; null quando ela só tem anexos (a Zernio não inventa texto) */
  text: z.string().nullable(),
  /** Um item por anexo, pelo tipo declarado pela Zernio (sem o arquivo, que expira) */
  attachmentTypes: z.array(z.enum(SOCIAL_ATTACHMENT_TYPES)).max(20),
  /** Horário de envio (sentAt quando a Zernio informa; senão createdAt) */
  sentAt: z.iso.datetime().nullable(),
});
export type SocialInboxMessage = z.infer<typeof socialInboxMessageSchema>;

export const socialInboxMessagesResponseSchema = z.strictObject({
  /** Em ordem cronológica (a mais antiga primeiro), ordenadas pelo horário de envio */
  messages: z.array(socialInboxMessageSchema),
  hasMore: z.boolean(),
  nextCursor: z.string().nullable(),
  /** Ordem que a Zernio aplicou na página (asc ou desc), para diagnóstico */
  sortOrderApplied: z.enum(['asc', 'desc']).nullable(),
  /** Só true quando a Zernio confirmou a ordem mais recente primeiro. Sem isso, o histórico não serve para a janela de resposta */
  historyReliable: z.boolean(),
});
export type SocialInboxMessagesResponse = z.infer<typeof socialInboxMessagesResponseSchema>;

// ----- Diagnóstico temporário das datas (Z2.4, homologação autorizada): só datas e campos, nunca o texto -----

export const SOCIAL_DATE_DIAGNOSTIC_LIMIT = 10;
export const socialDateDiagnosticInputSchema = z.strictObject({
  accountId: z.string().min(1).max(100),
  conversationId: z.string().min(1).max(300),
});
export type SocialDateDiagnosticInput = z.infer<typeof socialDateDiagnosticInputSchema>;

export const socialDateDiagnosticSchema = z.strictObject({
  /** Quantas mensagens foram lidas (no máximo 10) */
  readCount: z.number().int().nonnegative(),
  hasMore: z.boolean(),
  sortOrderApplied: z.enum(['asc', 'desc']).nullable(),
  messages: z.array(
    z.strictObject({
      direction: z.enum(['incoming', 'outgoing']),
      /** Se a mensagem tem texto (o texto em si nunca sai da API) */
      hasText: z.boolean(),
      attachmentTypes: z.array(z.enum(SOCIAL_ATTACHMENT_TYPES)),
      sentAt: z.iso.datetime().nullable(),
      createdAt: z.iso.datetime().nullable(),
      /** sentAt - createdAt, em segundos (null se algum dos dois falta) */
      sentMinusCreatedSeconds: z.number().nullable(),
    }),
  ),
  /** A ordem recebida da Zernio bate com a ordem por sentAt? e por createdAt? */
  orderMatchesSentAt: z.boolean(),
  orderMatchesCreatedAt: z.boolean(),
  /** Última mensagem recebida do contato (pelos dois campos) */
  lastIncoming: z.strictObject({ sentAt: z.iso.datetime().nullable(), createdAt: z.iso.datetime().nullable() }).nullable(),
  /** Mensagem mais recente lida, pelos dois campos */
  newest: z.strictObject({ sentAt: z.iso.datetime().nullable(), createdAt: z.iso.datetime().nullable() }).nullable(),
});
export type SocialDateDiagnostic = z.infer<typeof socialDateDiagnosticSchema>;

export const SOCIAL_DATE_DIAGNOSTIC_PATH = `${INBOX_PATH}/social/diagnostico-datas`;

// ----- Janela de resposta e limite de texto (Z3.1, aprovados em 2026-11-04) -----

/** Janela de 24 horas desde a última mensagem recebida do contato: resposta humana sem tag */
export const SOCIAL_REPLY_WINDOW_HOURS = 24;
/** Até 7 dias: HUMAN_AGENT com MESSAGE_TAG, só para resposta digitada por uma pessoa */
export const SOCIAL_HUMAN_AGENT_DAYS = 7;
/** Limite provisório para mensagens simples de texto (interface e servidor); o oficial da Zernio é 10.000 */
export const SOCIAL_REPLY_TEXT_MAX = 1000;

export type SocialReplyWindow =
  | { mode: 'free'; label: string }
  | { mode: 'human_agent'; label: string }
  | { mode: 'blocked'; reason: 'expired' | 'unknown_last_message' | 'unreliable_history'; label: string };

/**
 * Janela de resposta no Instagram. Calculada só com histórico confirmado e com a data da última mensagem do contato.
 * Sem dado confiável, bloqueia (falha fechada). IA, automações e campanhas nunca recebem "human_agent".
 */
export function socialReplyWindow(lastIncomingIso: string | null, historyReliable: boolean, nowMs: number): SocialReplyWindow {
  if (!historyReliable) return { mode: 'blocked', reason: 'unreliable_history', label: 'Histórico não confirmado: envio bloqueado' };
  const last = lastIncomingIso ? Date.parse(lastIncomingIso) : Number.NaN;
  if (Number.isNaN(last)) return { mode: 'blocked', reason: 'unknown_last_message', label: 'Sem data confiável da última mensagem do contato: envio bloqueado' };
  const hours = (nowMs - last) / 3_600_000;
  if (hours <= SOCIAL_REPLY_WINDOW_HOURS) return { mode: 'free', label: 'Janela aberta: resposta sem tag' };
  if (hours <= SOCIAL_HUMAN_AGENT_DAYS * 24) return { mode: 'human_agent', label: 'Fora de 24 h: só resposta digitada por uma pessoa, com HUMAN_AGENT' };
  return { mode: 'blocked', reason: 'expired', label: 'Janela encerrada (mais de 7 dias): envio bloqueado' };
}

// ----- Envio de respostas humanas pelo Instagram (Z3.2) -----

export const SOCIAL_SEND_PATH = `${INBOX_PATH}/social/messages`;

export const socialSendInputSchema = z.strictObject({
  accountId: z.string().min(1).max(100),
  conversationId: z.string().min(1).max(300),
  /** Gerado pelo painel: a mesma intenção nunca envia duas vezes */
  requestId: z.uuid('Pedido inválido. Recarregue a página.'),
  text: z.string().trim().min(1, 'Escreva a mensagem.').max(SOCIAL_REPLY_TEXT_MAX, `Use no máximo ${SOCIAL_REPLY_TEXT_MAX} caracteres.`),
});
export type SocialSendInput = z.input<typeof socialSendInputSchema>;

export const SOCIAL_SEND_STATUSES = ['sent', 'pending', 'failed', 'unknown'] as const;
export const socialSendResultSchema = z.strictObject({
  status: z.enum(SOCIAL_SEND_STATUSES),
  /** O mesmo pedido já tinha sido feito: nada foi enviado de novo */
  replayed: z.boolean(),
  providerMessageId: z.string().nullable(),
  /** Texto fixo para a tela (nunca o texto da Zernio) */
  message: z.string(),
});
export type SocialSendResult = z.infer<typeof socialSendResultSchema>;
