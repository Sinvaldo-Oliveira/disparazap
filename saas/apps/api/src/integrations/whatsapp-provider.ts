import { httpRequest, type HttpResponse } from './evolution-client.ts';

export type ProviderErrorKind = 'unreachable' | 'unauthorized' | 'not_found' | 'rejected' | 'invalid_response' | 'disconnected' | 'invalid_number';

const MESSAGES: Readonly<Record<ProviderErrorKind, string>> = {
  unreachable: 'O servidor de WhatsApp não respondeu. Tente de novo em instantes.',
  unauthorized: 'O servidor de WhatsApp recusou a credencial. Avise o administrador da plataforma.',
  not_found: 'A instância não foi encontrada no servidor de WhatsApp.',
  rejected: 'O servidor de WhatsApp não aceitou o pedido. Tente de novo em instantes.',
  invalid_response: 'O servidor de WhatsApp respondeu de um jeito inesperado. Tente de novo em instantes.',
  disconnected: 'O WhatsApp desta instância está desconectado. Conecte de novo na página WhatsApp.',
  invalid_number: 'O número não foi aceito pelo WhatsApp (inexistente ou sem WhatsApp).',
};

/** Falha da Evolution Go com mensagem fixa para a tela (nunca o corpo da resposta) */
export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly httpStatus: number | null;
  constructor(kind: ProviderErrorKind, httpStatus: number | null = null) {
    super(MESSAGES[kind]);
    this.name = 'ProviderError';
    this.kind = kind;
    this.httpStatus = httpStatus;
  }
}

export interface ProviderStatus {
  /** Conectado e com a sessão do WhatsApp ativa (Connected e LoggedIn) */
  connected: boolean;
}

/** Instância como o servidor a vê (GET /instance/info/{id} ou /instance/all), só com o que o DisparaZap usa */
export interface ServerInstance {
  id: string;
  name: string;
  connected: boolean;
  /** Número conectado, só dígitos (a partir do JID), ou null */
  phone: string | null;
}

/** Operações de negócio (ARQUITETURA_SAAS §5.1): o resto do sistema não conhece URLs nem cabeçalhos da Evolution */
export interface WhatsAppProvider {
  createInstance(input: { name: string; token: string }): Promise<{ providerInstanceId: string | null }>;
  findInstanceId(name: string): Promise<string | null>;
  /** `inboxEvents`: a instância está com a Inbox ligada (o /instance/connect regrava a configuração de eventos) */
  startConnection(token: string, inboxEvents?: boolean): Promise<void>;
  /** Imagem do QR Code (data URL) ou null quando não há QR (ex.: já conectado) */
  getQrCode(token: string): Promise<string | null>;
  pairWithPhone(token: string, phone: string): Promise<string>;
  getStatus(token: string): Promise<ProviderStatus>;
  /** Detalhes de uma instância pelo ID (chave global): de onde vem o número conectado */
  getInstance(providerInstanceId: string): Promise<ServerInstance | null>;
  /** Todas as instâncias do servidor (chave global), para atualizar o status das listas numa chamada só */
  listServerInstances(): Promise<ServerInstance[]>;
  logout(token: string): Promise<void>;
  deleteInstance(providerInstanceId: string): Promise<void>;
  /** Envia texto. Falhas viram ProviderError: disconnected, unauthorized, invalid_number, not_found, unreachable ou rejected */
  sendText(token: string, number: string, text: string): Promise<{ messageId: string | null }>;
  /** Envia uma imagem (bytes em base64, sem prefixo data:) com o texto como legenda. Falhas: as mesmas do sendText */
  sendImage(token: string, number: string, image: { base64: string; caption: string }): Promise<{ messageId: string | null }>;
  /** Liga (ou volta ao padrão) a entrega dos eventos da Inbox por WebSocket nesta instância */
  configureInboxEvents(token: string, enabled: boolean): Promise<void>;
}

/** Categorias de eventos que a Inbox assina (HOMOLOGACAO_I0_EVOLUTION §4) */
export const INBOX_EVENT_CATEGORIES = ['MESSAGE', 'SEND_MESSAGE', 'READ_RECEIPT', 'CONNECTION'] as const;
const inboxEventSettings = () => ({ subscribe: [...INBOX_EVENT_CATEGORIES], websocketEnable: 'enabled' });

export interface EvolutionProviderOptions {
  baseUrl: string;
  globalKey: string;
  timeoutMs?: number;
  /** O envio espera mais: a Evolution tenta reconectar antes de responder */
  sendTimeoutMs?: number;
  /** A imagem (até 5 MB) ainda precisa subir para o servidor */
  mediaTimeoutMs?: number;
}

type Json = Record<string, unknown>;

function asObject(value: unknown): Json | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : null;
}

/** Primeiro campo de texto não vazio entre os nomes conhecidos (a API mistura camelCase e PascalCase) */
function pickString(source: Json | null, keys: readonly string[]): string | null {
  if (!source) return null;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function pickBoolean(source: Json | null, keys: readonly string[]): boolean {
  if (!source) return false;
  return keys.some((key) => source[key] === true);
}

/** "5511988887777:12@s.whatsapp.net" ou "5511988887777:12" → "5511988887777" */
export function phoneFromJid(jid: string | null): string | null {
  if (!jid) return null;
  const digits = jid.split('@')[0]?.split(':')[0]?.replace(/\D/g, '') ?? '';
  return digits.length >= 10 && digits.length <= 15 ? digits : null;
}

/** Texto de erro da Evolution ({"error": "..."}), só para classificar: nunca é repassado */
function errorText(body: string): string {
  try {
    const parsed = asObject(JSON.parse(body));
    const inner = asObject(parsed?.data);
    const found = [parsed?.error, parsed?.message, inner?.error, inner?.message].find((value) => typeof value === 'string' && value.trim());
    return typeof found === 'string' ? found : '';
  } catch {
    return body.slice(0, 300);
  }
}

// A Evolution responde 500 (ou 400) com um texto para quase toda falha de envio (código-fonte, pkg/sendMessage):
// "no active session found", "client disconnected", "number ... is not registered on WhatsApp", "could not parse phone"…
const DISCONNECTED_RE = /no active session|client disconnected|not connected|not logged|logged out|websocket/i;
const INVALID_NUMBER_RE = /not registered|could not parse|invalid (phone|number|jid)|parse (phone|jid)|not on whatsapp/i;

export function classifySendFailure(status: number, body: string): ProviderErrorKind {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 404) return 'not_found';
  const text = errorText(body);
  if (DISCONNECTED_RE.test(text)) return 'disconnected';
  if (INVALID_NUMBER_RE.test(text)) return 'invalid_number';
  return 'rejected';
}

export function createEvolutionProvider({ baseUrl, globalKey, timeoutMs = 15_000, sendTimeoutMs = 30_000, mediaTimeoutMs = 60_000 }: EvolutionProviderOptions): WhatsAppProvider {
  async function send(method: 'GET' | 'POST' | 'DELETE', path: string, apikey: string, body: unknown, timeout: number): Promise<HttpResponse> {
    try {
      return await httpRequest(method, new URL(`${baseUrl}${path}`), { apikey }, body, timeout);
    } catch {
      throw new ProviderError('unreachable');
    }
  }

  function parse(response: HttpResponse): Json | null {
    if (!response.body.trim()) return null;
    try {
      return asObject(JSON.parse(response.body));
    } catch {
      throw new ProviderError('invalid_response', response.status);
    }
  }

  async function call(method: 'GET' | 'POST' | 'DELETE', path: string, apikey: string, body?: unknown): Promise<Json | null> {
    const response = await send(method, path, apikey, body, timeoutMs);
    if (response.status === 401 || response.status === 403) throw new ProviderError('unauthorized', response.status);
    if (response.status === 404) throw new ProviderError('not_found', 404);
    if (response.status < 200 || response.status >= 300) throw new ProviderError('rejected', response.status);
    return parse(response);
  }

  const data = (payload: Json | null): Json | null => asObject(payload?.data) ?? payload;

  // Modelo Instance da Evolution (pkg/instance/model): id, name, jid e connected (estado ao vivo na lista e no info)
  function toServerInstance(item: Json | null): ServerInstance | null {
    const id = pickString(item, ['id', 'ID', 'instanceId', 'Id']);
    if (!id) return null;
    return {
      id,
      name: pickString(item, ['name', 'Name']) ?? '',
      connected: pickBoolean(item, ['connected', 'Connected']),
      phone: phoneFromJid(pickString(item, ['jid', 'Jid', 'JID'])),
    };
  }

  async function listServerInstances(): Promise<ServerInstance[]> {
    const payload = await call('GET', '/instance/all', globalKey);
    const list = payload?.data;
    if (!Array.isArray(list)) throw new ProviderError('invalid_response');
    return list.map((item) => toServerInstance(asObject(item))).filter((item): item is ServerInstance => item !== null);
  }

  // Envio de texto e de mídia: { data: { Info: { ID }, Message, MessageContextInfo } }; falhas classificadas pelo texto
  function messageResult(response: HttpResponse): { messageId: string | null } {
    if (response.status < 200 || response.status >= 300) throw new ProviderError(classifySendFailure(response.status, response.body), response.status);
    const info = asObject(data(parse(response))?.Info);
    return { messageId: pickString(info, ['ID', 'Id', 'id']) };
  }

  async function findInstanceId(name: string): Promise<string | null> {
    return (await listServerInstances()).find((item) => item.name === name)?.id ?? null;
  }

  return {
    async createInstance({ name, token }) {
      const payload = await call('POST', '/instance/create', globalKey, { name, token });
      const id = pickString(data(payload), ['id', 'ID', 'instanceId', 'Id']);
      return { providerInstanceId: id ?? (await findInstanceId(name)) };
    },

    findInstanceId,

    async startConnection(token, inboxEvents = false) {
      // Sem webhook: a API ainda não tem endereço público (PLANO_MODULO_WHATSAPP §1); o status é consultado periodicamente.
      // O /instance/connect regrava a configuração de eventos: com a Inbox ligada, reconectar não pode desligá-la
      await call('POST', '/instance/connect', token, inboxEvents ? inboxEventSettings() : {});
    },

    async getQrCode(token) {
      // { data: { qrcode, code } }: as duas partes do QR guardado; a imagem é a que começa com data:image/
      const body = data(await call('GET', '/instance/qr', token));
      for (const key of ['code', 'qrcode', 'Code', 'Qrcode', 'base64']) {
        const value = pickString(body, [key]);
        if (value?.startsWith('data:image/')) return value;
      }
      return null;
    },

    async pairWithPhone(token, phone) {
      const payload = await call('POST', '/instance/pair', token, { phone });
      const code = pickString(data(payload), ['PairingCode', 'pairingCode', 'code', 'Code']);
      if (!code) throw new ProviderError('invalid_response');
      return code;
    },

    async getStatus(token) {
      // { data: { Connected, LoggedIn, Name } } (StatusStruct sem tags JSON): não traz o número
      const body = data(await call('GET', '/instance/status', token));
      return { connected: pickBoolean(body, ['Connected', 'connected']) && pickBoolean(body, ['LoggedIn', 'loggedIn']) };
    },

    async getInstance(providerInstanceId) {
      const payload = await call('GET', `/instance/info/${encodeURIComponent(providerInstanceId)}`, globalKey);
      return toServerInstance(data(payload));
    },

    listServerInstances,

    async logout(token) {
      await call('DELETE', '/instance/logout', token);
    },

    async deleteInstance(providerInstanceId) {
      await call('DELETE', `/instance/delete/${encodeURIComponent(providerInstanceId)}`, globalKey);
    },

    async sendText(token, number, text) {
      return messageResult(await send('POST', '/send/text', token, { number, text, delay: 0 }, sendTimeoutMs));
    },

    async sendImage(token, number, { base64, caption }) {
      // pkg/sendMessage: "url" que não começa com http(s) é lido como base64 puro (sem "data:...;base64,")
      return messageResult(await send('POST', '/send/media', token, { number, type: 'image', url: base64, caption, delay: 0 }, mediaTimeoutMs));
    },

    async configureInboxEvents(token, enabled) {
      // Código-fonte 0.6.1–0.7.2 (instance_service.Connect + UpdateInstanceSettings): numa instância em execução, grava e
      // aplica as configurações sem reconectar o número. {} volta ao padrão (só MESSAGE, sem canal de entrega)
      await call('POST', '/instance/connect', token, enabled ? inboxEventSettings() : {});
    },
  };
}
