import {
  INBOX_CHANNELS_PATH,
  INBOX_CONVERSATIONS_PATH,
  INBOX_STREAM_PATH,
  inboxActivationPath,
  inboxChannelsResponseSchema,
  inboxConversationDetailSchema,
  inboxConversationPath,
  inboxConversationsResponseSchema,
  inboxMessagesPath,
  inboxReadPath,
  inboxSendResultSchema,
  inboxStreamEventSchema,
  INBOX_SOCIAL_CONVERSATIONS_PATH,
  SOCIAL_DATE_DIAGNOSTIC_PATH,
  SOCIAL_SEND_PATH,
  socialDateDiagnosticSchema,
  socialSendResultSchema,
  type SocialDateDiagnostic,
  type SocialSendInput,
  type SocialSendResult,
  socialInboxConversationsResponseSchema,
  socialInboxMessagesPath,
  socialInboxMessagesResponseSchema,
  type SocialInboxConversationsResponse,
  type SocialInboxMessagesResponse,
  type InboxChannelsResponse,
  type InboxConversationDetail,
  type InboxConversationsQuery,
  type InboxConversationsResponse,
  type InboxSendInput,
  type InboxSendResult,
  type InboxStreamEvent,
} from '@disparazap/contracts';
import { request, type ApiResult } from '../platform/platform-api';

/** Situação do canal em tempo real: "up" = avisos chegando; "down" = o painel consulta de tempos em tempos */
export type InboxLiveStatus = 'up' | 'down';

export interface InboxSubscription {
  close(): void;
}

/**
 * Inbox (PLANO_MODULO_INBOX, I1). O painel fala só com a API do DisparaZap (nunca com a Evolution Go). O canal em tempo
 * real só avisa o que mudou; o conteúdo vem sempre pelas rotas. Os testes trocam esta interface por uma falsa.
 */
export interface InboxApi {
  channels(signal?: AbortSignal): Promise<ApiResult<InboxChannelsResponse>>;
  conversations(query: InboxConversationsQuery, signal?: AbortSignal): Promise<ApiResult<InboxConversationsResponse>>;
  conversation(id: string, before?: string | null, signal?: AbortSignal): Promise<ApiResult<InboxConversationDetail>>;
  markRead(id: string): Promise<ApiResult<null>>;
  send(id: string, input: InboxSendInput): Promise<ApiResult<InboxSendResult>>;
  /** Liga ou desliga o recebimento numa instância (Integrações → WhatsApp) */
  setReception(accountId: string, enabled: boolean): Promise<ApiResult<InboxChannelsResponse>>;
  subscribe(onEvent: (event: InboxStreamEvent) => void, onStatus: (status: InboxLiveStatus) => void): InboxSubscription;
  /** Conversas de uma conta do Instagram (lidas da Zernio a cada pedido; nada é gravado) */
  socialConversations(accountId: string, cursor: string | null, signal?: AbortSignal): Promise<ApiResult<SocialInboxConversationsResponse>>;
  /** Mensagens de uma conversa do Instagram, em ordem cronológica (só leitura) */
  socialMessages(conversationId: string, accountId: string, cursor: string | null, signal?: AbortSignal): Promise<ApiResult<SocialInboxMessagesResponse>>;
  /** Diagnóstico temporário das datas (Z2.4): só dono e administradores; até 10 mensagens; sem texto */
  socialDateDiagnostic(conversationId: string, accountId: string): Promise<ApiResult<SocialDateDiagnostic>>;
  /** Resposta humana pelo Instagram (Z3.2). O requestId garante que a mesma intenção nunca envia duas vezes */
  socialSend(input: SocialSendInput): Promise<ApiResult<SocialSendResult>>;
}

const withSignal = (signal?: AbortSignal) => (signal ? { signal } : {});

function queryString(query: InboxConversationsQuery): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) if (value !== undefined && value !== null && value !== '') params.set(name, String(value));
  const text = params.toString();
  return text ? `?${text}` : '';
}

/** EventSource do navegador: reconecta sozinho (a API pede 3 s); se ele desistir (sessão vencida), o painel segue consultando */
function subscribeWithEventSource(onEvent: (event: InboxStreamEvent) => void, onStatus: (status: InboxLiveStatus) => void): InboxSubscription {
  if (typeof EventSource === 'undefined') {
    onStatus('down');
    return { close: () => {} };
  }
  const source = new EventSource(INBOX_STREAM_PATH, { withCredentials: true });
  source.onopen = () => onStatus('up');
  source.onerror = () => onStatus('down');
  source.onmessage = (message: MessageEvent<string>) => {
    try {
      onEvent(inboxStreamEventSchema.parse(JSON.parse(message.data)));
    } catch {
      // Aviso fora do formato: ignorado (a consulta periódica cobre)
    }
  };
  return { close: () => source.close() };
}

export const httpInboxApi: InboxApi = {
  channels: (signal) => request(INBOX_CHANNELS_PATH, { method: 'GET', ...withSignal(signal) }, (body) => inboxChannelsResponseSchema.parse(body)),
  conversations: (query, signal) => request(`${INBOX_CONVERSATIONS_PATH}${queryString(query)}`, { method: 'GET', ...withSignal(signal) }, (body) => inboxConversationsResponseSchema.parse(body)),
  conversation: (id, before, signal) =>
    request(`${inboxConversationPath(id)}${before ? `?before=${encodeURIComponent(before)}` : ''}`, { method: 'GET', ...withSignal(signal) }, (body) => inboxConversationDetailSchema.parse(body)),
  markRead: (id) => request(inboxReadPath(id), { method: 'POST', body: '{}' }, () => null),
  send: (id, input) => request(inboxMessagesPath(id), { method: 'POST', body: JSON.stringify(input) }, (body) => inboxSendResultSchema.parse(body)),
  setReception: (accountId, enabled) =>
    request(inboxActivationPath(accountId), enabled ? { method: 'POST', body: '{}' } : { method: 'DELETE' }, (body) => inboxChannelsResponseSchema.parse(body)),
  subscribe: subscribeWithEventSource,
  socialConversations: (accountId, cursor, signal) =>
    request(`${INBOX_SOCIAL_CONVERSATIONS_PATH}?${new URLSearchParams({ accountId, ...(cursor ? { cursor } : {}) }).toString()}`, { method: 'GET', ...withSignal(signal) }, (body) => socialInboxConversationsResponseSchema.parse(body)),
  socialDateDiagnostic: (conversationId, accountId) =>
    request(SOCIAL_DATE_DIAGNOSTIC_PATH, { method: 'POST', body: JSON.stringify({ conversationId, accountId }) }, (body) => socialDateDiagnosticSchema.parse(body)),
  socialSend: (input) =>
    request(SOCIAL_SEND_PATH, { method: 'POST', body: JSON.stringify(input) }, (body) => socialSendResultSchema.parse(body)),
  socialMessages: (conversationId, accountId, cursor, signal) =>
    request(`${socialInboxMessagesPath(conversationId)}?${new URLSearchParams({ accountId, ...(cursor ? { cursor } : {}) }).toString()}`, { method: 'GET', ...withSignal(signal) }, (body) => socialInboxMessagesResponseSchema.parse(body)),
};
