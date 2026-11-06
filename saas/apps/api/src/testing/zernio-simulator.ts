import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Zernio simulada (só para testes e demonstrações; fora do build de produção).
 * Formatos tirados da documentação oficial e da especificação OpenAPI 1.444.0 (saas/docs/REFERENCIA_ZERNIO.md):
 * Bearer com chave sk_, erros { error, type, code, details }, /v1/auth/verify, /v1/profiles, /v1/connect/{platform}
 * com volta para o redirect_url, /v1/accounts, /v1/accounts/health e DELETE /v1/accounts/{id}.
 */
export interface SimProfile {
  _id: string;
  name: string;
  externalId: string | null;
}

export interface SimAccount {
  _id: string;
  platform: string;
  profileId: string;
  username: string;
  displayName: string;
  profileUrl: string;
  isActive: boolean;
  needsReconnection: boolean;
}

/** Automação de comentário crua (PLANO_MODULO_AUTOMACOES): campos como a Zernio devolve; profileId só para o filtro */
export interface SimCommentAutomation {
  id: string;
  profileId: string;
  accountId: string;
  [field: string]: unknown;
}

/** Registro cru de envio (A4), como a Zernio devolve: status pending, sent, gated, skipped ou failed */
export interface SimAutomationLog {
  id: string;
  status: string;
  source: string | null;
  error: string | null;
  clickCount: number;
  createdAt: string;
  commentText: string | null;
  commenterName: string | null;
  commenterUsername: string | null;
}

/** Fluxo de link cru (A5): nodes e edges como o corpo do pedido; status draft, active ou paused */
export interface SimWorkflow {
  id: string;
  profileId: string;
  accountId: string;
  platform: string;
  name: string;
  description?: string;
  nodes?: unknown[];
  edges?: unknown[];
  status: 'draft' | 'active' | 'paused';
}

export interface SimInboxThread {
  id: string;
  accountId: string;
  /** Padrão: instagram */
  platform?: string;
  participantName: string | null;
  lastMessage: string | null;
  updatedTime: string;
  status: 'active' | 'archived';
  unreadCount: number | null;
  messages: { id: string; direction: 'incoming' | 'outgoing'; message: string | null; createdAt: string; attachments?: { type: string }[] }[];
}

export interface SimConnectRequest {
  platform: string;
  /** Parâmetros exatamente como chegaram (para conferir os nomes: a Zernio ignora nomes errados em silêncio) */
  query: Record<string, string>;
}

/** Uma rede de destino de um post simulado (formato PlatformTarget da especificação 1.450.2) */
export interface SimPostTarget {
  platform: string;
  accountId: string;
  customContent?: string;
  platformSpecificData?: Record<string, unknown>;
  status: string;
  platformPostUrl?: string;
  publishedAt?: string;
  errorCategory?: string;
  errorMessage?: string;
}

export interface SimPost {
  _id: string;
  profileId: string;
  content: string;
  mediaItems: { type: string; url: string }[];
  platforms: SimPostTarget[];
  scheduledFor?: string;
  timezone?: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

/** Pedido recebido nas rotas de posts (para conferir os nomes exatos dos campos e cabeçalhos) */
export interface SimRequest {
  method: string;
  path: string;
  body: Record<string, unknown>;
  headers: Record<string, string | string[] | undefined>;
}

/** Arquivo recebido no endereço assinado (armazenamento), com o Authorization que veio (deve ser nenhum) */
export interface SimUpload {
  key: string;
  contentType: string | undefined;
  bytes: Buffer;
  authorization: string | undefined;
}

const PRESIGN_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/quicktime']);
const LIST_PARAMS = new Set(['page', 'limit', 'offset', 'cursor', 'fields', 'updatedSince', 'source', 'status', 'platform', 'profileId', 'createdBy', 'fromDate', 'toDate', 'dateFrom', 'dateTo', 'includeHidden', 'search', 'tags', 'tag', 'sortBy', 'accountId']);
const LIST_FIELDS = new Set(['userId', 'title', 'content', 'mediaItems', 'platforms', 'scheduledFor', 'timezone', 'status', 'tags', 'hashtags', 'mentions', 'visibility', 'metadata', 'recycling', 'recycledFromPostId', 'queuedFromProfile', 'queueId', 'createdAt', 'updatedAt', '_id']);
const NO_UNPUBLISH = new Set(['instagram', 'tiktok', 'snapchat']);
/** Números fixos por rede publicada, para as métricas simuladas */
const SIM_METRICS = { impressions: 120, reach: 80, likes: 12, comments: 3, shares: 2, saves: 1, clicks: 4, views: 150 } as const;

async function readRaw(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json', 'x-request-id': randomUUID() });
  res.end(JSON.stringify(body));
};

const fail = (res: ServerResponse, status: number, type: string, code: string, error: string, details?: Record<string, unknown>) =>
  json(res, status, { error, type, code, ...(details ? { details } : {}) });

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>;
  } catch {
    return {};
  }
}

export class ZernioSimulator {
  url = '';
  readonly keys = new Set<string>();
  readonly profiles = new Map<string, SimProfile>();
  readonly accounts = new Map<string, SimAccount>();
  readonly connectRequests: SimConnectRequest[] = [];
  readonly deleted: string[] = [];
  /** Cabeçalhos Authorization recebidos (para conferir que a chave certa foi usada) */
  readonly seenKeys: string[] = [];
  accountName = 'Conta Zernio de Teste';
  /** Simula uma resposta que traz contas de outros perfis (o DisparaZap precisa filtrar pelo perfil da empresa) */
  leakAllAccounts = false;
  /** Cobrança como a da Zernio: X exige cartão; mais de 2 redes na conta exige cartão (desligado por padrão nos testes) */
  enforceBilling = false;
  hasPaymentMethod = false;
  /** Simula a lista da conta inteira fora do ar (o total é complementar: a lista do perfil continua) */
  teamListUnavailable = false;
  /** Próxima resposta forçada, para simular erros da Zernio (402, 429, 503…) */
  failNext: { status: number; body: Record<string, unknown>; headers?: Record<string, string> } | null = null;
  /** Próxima resposta forçada só numa rota (ex.: POST /posts), deixando passar as leituras antes dela */
  failRoute: { method: string; path: string; status: number; body: Record<string, unknown>; headers?: Record<string, string> } | null = null;

  /** Resposta da leitura da Inbox (GET /inbox/conversations): ok, addon, forbidden, payment, rate_limit, server, odd ou unauthorized */
  inboxMode: 'ok' | 'addon' | 'forbidden' | 'payment' | 'rate_limit' | 'server' | 'odd' | 'unauthorized' = 'ok';
  /** Quantas conversas a leitura devolve (só a contagem é usada pelo DisparaZap) */
  inboxConversations = 0;
  /** Pedidos recebidos na leitura da Inbox (o teste confere perfil e limite) */
  readonly inboxRequests: { profileId: string; limit: string | null }[] = [];
  /** Conversas de Instagram com mensagens de teste (Z2): só texto fictício */
  readonly inboxThreads: SimInboxThread[] = [];
  /** Os testes ligam para simular a Zernio devolvendo conversas de outras contas na mesma lista */
  leakInboxThreads = false;
  /** Auditoria Z3: a Zernio ignora o sortOrder pedido e devolve a página em ordem crescente */
  ignoreSortOrder = false;
  /** Resposta do envio (Z3.2): ok, 409, 422, 429, 500, 502, sem_id (200 sem messageId) ou janela (403 da Meta) */
  sendMode: 'ok' | '409' | '422' | '429' | '500' | '502' | 'sem_id' | 'janela' = 'ok';
  /** Envios aceitos pela simulação (os testes conferem os campos; nada disso vai para logs) */
  readonly sentMessages: { conversationId: string; accountId: string; message: string; messageTag?: string; messagingType?: string; idempotencyKey: string }[] = [];
  /** Respostas já dadas por chave de idempotência (replay e reuso com corpo diferente) */
  readonly sendReplies = new Map<string, { body: string; status: number; response: unknown }>();

  // ----- Automações (PLANO_MODULO_AUTOMACOES, A1: só leitura) -----
  /** Automações de comentário cruas, como a Zernio devolve (só dados fictícios) */
  readonly commentAutomations: SimCommentAutomation[] = [];
  /** Os testes ligam para simular a Zernio devolvendo automações de outros perfis na mesma lista */
  leakAutomations = false;
  /** Resposta da leitura de automações: ok, forbidden (403), server (503) ou odd (fora do formato) */
  automationsMode: 'ok' | 'forbidden' | 'server' | 'odd' = 'ok';
  /** Perfis pedidos em cada GET /v1/comment-automations (o teste confere que é sempre o da empresa) */
  readonly automationRequests: (string | null)[] = [];
  /** Criar, alterar e excluir (A2): cada pedido recebido, com o corpo (só dados fictícios) */
  readonly automationWrites: { method: string; id: string | null; body: Record<string, unknown> }[] = [];
  /** Resposta da escrita: ok, invalid (400), conflict (409), server (503) ou odd (200 sem a automação) */
  automationWriteMode: 'ok' | 'invalid' | 'conflict' | 'server' | 'odd' = 'ok';
  private automationSeq = 0;

  // ----- Fluxos de link (PLANO_MODULO_AUTOMACOES, A5): workflows como a Zernio guarda (só dados fictícios) -----
  readonly workflows: SimWorkflow[] = [];
  /** Pedidos de fluxo recebidos (criar, ativar, pausar, excluir), com o corpo */
  readonly workflowWrites: { method: string; path: string; body: Record<string, unknown> }[] = [];
  private workflowSeq = 0;

  // ----- Atividade (A4): registros por automação e comentários que não casaram (só dados fictícios) -----
  readonly automationLogs = new Map<string, SimAutomationLog[]>();
  readonly automationMisses: { commentText: string; commenterName: string; excludedBy: string | null; at: string }[] = [];

  /** Como a lista da Zernio mostra um fluxo: sem o grafo */
  private workflowSummary(workflow: SimWorkflow) {
    const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
    return { id: workflow.id, name: workflow.name, description: workflow.description ?? null, platform: workflow.platform, accountId: workflow.accountId, status: workflow.status, nodeCount: nodes.length, totalStarted: 0, totalCompleted: 0 };
  }

  /**
   * Regras da documentação oficial (comment-automations, 2026-11-05): Instagram e Facebook exigem a DM; TikTok, Threads,
   * LinkedIn e YouTube só aceitam a resposta pública; X e as demais não são suportadas; com botões, a DM tem até 640.
   */
  private automationRefusal(body: Record<string, unknown>, creating: boolean): ((res: ServerResponse) => void) | null {
    if (this.automationWriteMode === 'invalid') return (res) => fail(res, 400, 'invalid_request_error', 'invalid_field_value', 'Field rejected by the platform', { param: 'dmMessage' });
    if (this.automationWriteMode === 'conflict') return (res) => fail(res, 409, 'invalid_request_error', 'conflict', 'Active per-post automation already exists for this platformPostId');
    if (this.automationWriteMode === 'server') return (res) => fail(res, 503, 'api_error', 'service_unavailable', 'Temporarily unavailable');
    const account = this.accounts.get(String(body.accountId ?? ''));
    if (creating && (!account || account.profileId !== body.profileId)) return (res) => fail(res, 404, 'not_found', 'account_not_found', 'Account not found');
    const platform = account?.platform ?? '';
    const buttons = Array.isArray(body.buttons) ? body.buttons : [];
    const dm = typeof body.dmMessage === 'string' ? body.dmMessage : '';
    // story_reply, story_mention e live_comment: só Instagram
    if (typeof body.trigger === 'string' && body.trigger !== 'comment' && platform !== 'instagram') {
      return (res) => fail(res, 400, 'invalid_request_error', 'invalid_field_value', 'Trigger is Instagram-only', { param: 'trigger' });
    }
    if (platform === 'instagram' || platform === 'facebook') {
      if (!dm) return (res) => fail(res, 400, 'invalid_request_error', 'missing_required_field', 'dmMessage is required', { param: 'dmMessage' });
      if (buttons.length > 0 && dm.length > 640) return (res) => fail(res, 400, 'invalid_request_error', 'invalid_field_value', 'dmMessage too long with buttons', { param: 'dmMessage' });
      return null;
    }
    if (['tiktok', 'threads', 'linkedin', 'youtube'].includes(platform)) {
      if (dm || buttons.length > 0 || body.alsoMatchInDms === true || body.audience || body.followGate) {
        return (res) => fail(res, 400, 'invalid_request_error', 'invalid_field_value', 'DM fields are not supported', { param: 'dmMessage' });
      }
      if (typeof body.commentReply !== 'string' || !body.commentReply) return (res) => fail(res, 400, 'invalid_request_error', 'missing_required_field', 'commentReply is required', { param: 'commentReply' });
      return null;
    }
    return (res) => fail(res, 400, 'invalid_request_error', 'platform_not_supported', 'Platform not supported');
  }

  // ----- Publicações (Redes Sociais) -----
  readonly posts = new Map<string, SimPost>();
  readonly postRequests: SimRequest[] = [];
  readonly uploads: SimUpload[] = [];
  readonly presigns: Record<string, unknown>[] = [];
  /** Parâmetros de cada GET /v1/posts (sincronização incremental) */
  readonly listQueries: Record<string, string>[] = [];
  /** Redes que falham ao publicar (com a categoria de erro e um texto bruto que nunca pode chegar à tela) */
  readonly failPlatforms = new Set<string>();
  failCategory = 'user_content';
  /** Atraso da próxima resposta de POST /v1/posts (o post é gravado antes: simula o tempo-limite estourado no cliente) */
  delayNextPostMs = 0;
  /** Conta Zernio de plano antigo, sem o complemento de métricas (402) */
  analyticsLocked = false;
  boards = [
    { id: 'board_promocoes', name: 'Promoções', description: '', privacy: 'PUBLIC' },
    { id: 'board_novidades', name: 'Novidades', description: '', privacy: 'PUBLIC' },
  ];
  readonly #idempotency = new Map<string, string>();
  readonly #server: Server;
  #seq = 0;

  constructor(...keys: string[]) {
    for (const key of keys) this.keys.add(key);
    this.#server = createServer((req, res) => {
      void this.#handle(req, res).catch(() => fail(res, 500, 'api_error', 'internal_error', 'Simulator error'));
    });
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve) => this.#server.listen(0, '127.0.0.1', resolve));
    this.url = `http://127.0.0.1:${(this.#server.address() as AddressInfo).port}/api/v1`;
  }

  stop(): Promise<void> {
    return new Promise((resolve) => this.#server.close(() => resolve()));
  }

  #id(prefix: string) {
    return `${prefix}_${(++this.#seq).toString(16).padStart(6, '0')}${randomUUID().slice(0, 8)}`;
  }

  /** A pessoa autorizou na rede: cria (ou renova) a conta no perfil e devolve o endereço de volta, como a Zernio faz */
  authorize(username = 'loja_exemplo', request = this.connectRequests.at(-1)): string {
    if (!request) throw new Error('nenhum pedido de conexão');
    const target = new URL(request.query.redirect_url ?? '');
    const reconnect = request.query.reconnectAccountId;
    let account = reconnect ? this.accounts.get(reconnect) : undefined;
    if (account) {
      account.needsReconnection = false;
      account.isActive = true;
    } else {
      account = {
        _id: this.#id('acc'),
        platform: request.platform,
        profileId: request.query.profileId ?? '',
        username,
        displayName: `Loja Exemplo (${request.platform})`,
        profileUrl: `https://social.exemplo.test/${username}`,
        isActive: true,
        needsReconnection: false,
      };
      this.accounts.set(account._id, account);
    }
    target.searchParams.set('connected', request.platform);
    target.searchParams.set('profileId', account.profileId);
    target.searchParams.set('accountId', account._id);
    target.searchParams.set('username', account.username);
    return target.toString();
  }

  /** A pessoa cancelou (ou a rede recusou): volta com error, como a Zernio faz */
  deny(error = 'oauth_denied', request = this.connectRequests.at(-1)): string {
    if (!request) throw new Error('nenhum pedido de conexão');
    const target = new URL(request.query.redirect_url ?? '');
    target.searchParams.set('error', error);
    target.searchParams.set('platform', request.platform);
    target.searchParams.set('error_message', '<b>texto livre da Zernio que nunca deve aparecer na tela</b>');
    return target.toString();
  }

  /** Post criado direto no painel da Zernio (fora do DisparaZap), para testar a sincronização */
  addExternalPost(input: { profileId: string; accountId: string; platform: string; content: string; status?: string; scheduledFor?: string }): SimPost {
    const now = new Date().toISOString();
    const post: SimPost = {
      _id: this.#id('post'),
      profileId: input.profileId,
      content: input.content,
      mediaItems: [],
      platforms: [{ platform: input.platform, accountId: input.accountId, status: input.status === 'published' ? 'published' : 'pending' }],
      status: input.status ?? 'scheduled',
      ...(input.scheduledFor ? { scheduledFor: input.scheduledFor } : {}),
      timezone: 'America/Sao_Paulo',
      createdAt: now,
      updatedAt: now,
    };
    this.posts.set(post._id, post);
    return post;
  }

  /** Publica as redes pendentes (ou as que falharam, na nova tentativa), como a Zernio faz */
  #publish(post: SimPost, only: (target: SimPostTarget) => boolean = () => true) {
    const now = new Date().toISOString();
    for (const target of post.platforms) {
      if (!only(target)) continue;
      if (this.failPlatforms.has(target.platform)) {
        target.status = 'failed';
        target.errorCategory = this.failCategory;
        target.errorMessage = '<script>texto bruto da rede que nunca pode aparecer na tela</script>';
        delete target.platformPostUrl;
      } else {
        target.status = 'published';
        target.platformPostUrl = `https://social.exemplo.test/${target.platform}/${post._id}`;
        target.publishedAt = now;
        delete target.errorCategory;
        delete target.errorMessage;
      }
    }
    const published = post.platforms.filter((target) => target.status === 'published').length;
    post.status = published === post.platforms.length ? 'published' : published === 0 ? 'failed' : 'partial';
    post.updatedAt = now;
  }

  /** Resposta do post como a Zernio manda: conta populada nas listas (o DisparaZap precisa aceitar id ou objeto) */
  #publicPost(post: SimPost, populate = false) {
    const { profileId: _profile, ...rest } = post;
    return {
      ...rest,
      platforms: post.platforms.map((target) => {
        const account = this.accounts.get(target.accountId);
        return populate && account ? { ...target, accountId: { _id: account._id, username: account.username, displayName: account.displayName, profileId: account.profileId } } : target;
      }),
    };
  }

  #publishOutcome(res: ServerResponse, post: SimPost, okStatus: number) {
    if (post.status === 'partial' || post.status === 'failed') {
      const platformResults = post.platforms.map((target) => ({ platform: target.platform, status: target.status, error: target.errorMessage ?? null }));
      return json(res, 207, { post: this.#publicPost(post), message: 'Publish did not fully succeed', platformResults, ...(post.status === 'failed' ? { error: 'All platforms failed' } : {}) });
    }
    return json(res, okStatus, { message: 'ok', post: this.#publicPost(post) });
  }

  /** Aplica os campos de POST/PUT /v1/posts num post (nomes exatos da especificação) */
  #applyBody(post: SimPost, body: Record<string, unknown>): string | null {
    if (typeof body.content === 'string') post.content = body.content;
    if (Array.isArray(body.mediaItems)) post.mediaItems = (body.mediaItems as Record<string, unknown>[]).map((item) => ({ type: String(item.type ?? 'image'), url: String(item.url ?? '') }));
    if (Array.isArray(body.platforms)) {
      const targets: SimPostTarget[] = [];
      for (const raw of body.platforms as Record<string, unknown>[]) {
        const account = this.accounts.get(String(raw.accountId ?? ''));
        if (!account || account.platform !== raw.platform) return 'invalid_account';
        targets.push({
          platform: String(raw.platform),
          accountId: account._id,
          status: 'pending',
          ...(typeof raw.customContent === 'string' ? { customContent: raw.customContent } : {}),
          ...(raw.platformSpecificData && typeof raw.platformSpecificData === 'object' ? { platformSpecificData: raw.platformSpecificData as Record<string, unknown> } : {}),
        });
      }
      post.platforms = targets;
      const first = this.accounts.get(targets[0]?.accountId ?? '');
      if (first) post.profileId = first.profileId;
    }
    if (typeof body.timezone === 'string') post.timezone = body.timezone;
    if (typeof body.scheduledFor === 'string') post.scheduledFor = body.scheduledFor;
    return null;
  }

  async #handlePosts(req: IncomingMessage, res: ServerResponse, url: URL, path: string, method: string): Promise<boolean> {
    if (path === '/media/presign' && method === 'POST') {
      const body = await readBody(req);
      this.presigns.push(body);
      if (typeof body.filename !== 'string' || !body.filename) return (fail(res, 400, 'invalid_request_error', 'validation_error', 'filename is required'), true);
      if (!PRESIGN_TYPES.has(String(body.contentType))) return (fail(res, 400, 'invalid_request_error', 'INVALID_FIELD_VALUE', 'unsupported contentType', { field: 'contentType' }), true);
      const origin = new URL(this.url).origin;
      const key = `uploads/${this.#id('media')}-${body.filename}`;
      json(res, 200, { uploadUrl: `${origin}/${key}?X-Signature=assinatura-simulada`, publicUrl: `${origin}/public/${key}`, key, expiresIn: 3600 });
      return true;
    }

    if (path === '/posts' && method === 'POST') {
      const body = await readBody(req);
      this.postRequests.push({ method, path, body, headers: req.headers });
      const key = req.headers['idempotency-key'];
      const replay = typeof key === 'string' ? this.posts.get(this.#idempotency.get(key) ?? '') : undefined;
      if (replay) return (json(res, 200, { message: 'Idempotent replay', post: this.#publicPost(replay) }), true);
      const now = new Date().toISOString();
      const post: SimPost = { _id: this.#id('post'), profileId: '', content: '', mediaItems: [], platforms: [], status: 'draft', createdAt: now, updatedAt: now };
      const invalid = this.#applyBody(post, body);
      if (invalid) return (fail(res, 400, 'invalid_request_error', invalid, 'Account not found in your team'), true);
      if (!post.platforms.length && body.isDraft !== true) return (fail(res, 400, 'invalid_request_error', 'validation_error', 'platforms is required'), true);
      this.posts.set(post._id, post);
      if (typeof key === 'string') this.#idempotency.set(key, post._id);
      if (body.isDraft === true) post.status = 'draft';
      else if (body.publishNow === true) this.#publish(post);
      else if (typeof body.scheduledFor === 'string') {
        if (Date.parse(body.scheduledFor) <= Date.now()) this.#publish(post);
        else post.status = 'scheduled';
      } else post.status = 'draft';
      if (this.delayNextPostMs) {
        const delay = this.delayNextPostMs;
        this.delayNextPostMs = 0;
        await sleep(delay);
      }
      this.#publishOutcome(res, post, 201);
      return true;
    }

    if (path === '/posts' && method === 'GET') {
      const query = Object.fromEntries(url.searchParams.entries());
      this.listQueries.push(query);
      const unknown = Object.keys(query).find((name) => !LIST_PARAMS.has(name));
      if (unknown) return (fail(res, 400, 'invalid_request_error', 'unknown_parameter', `Unknown query parameter: ${unknown}`), true);
      const badField = (query.fields ?? '').split(',').filter(Boolean).find((field) => !LIST_FIELDS.has(field));
      if (badField) return (fail(res, 400, 'invalid_request_error', 'unknown_field', `Unknown field: ${badField}`), true);
      const since = query.updatedSince ? Date.parse(query.updatedSince) : null;
      if (query.updatedSince && (Number.isNaN(since) || !/(Z|[+-]\d{2}:\d{2})$/.test(query.updatedSince))) return (fail(res, 400, 'invalid_request_error', 'validation_error', 'updatedSince needs an offset'), true);
      const all = [...this.posts.values()]
        .filter((post) => !query.profileId || post.profileId === query.profileId)
        .filter((post) => since === null || Date.parse(post.updatedAt) >= since)
        .filter((post) => !query.status || post.status === query.status)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const limit = Math.min(Number(query.limit ?? 10), 500);
      const offset = query.cursor ? Number(query.cursor) : 0;
      const page = all.slice(offset, offset + limit);
      const next = offset + limit < all.length ? String(offset + limit) : null;
      json(res, 200, { posts: page.map((post) => this.#publicPost(post, true)), pagination: { page: 1, limit, total: all.length, pages: Math.ceil(all.length / limit), nextCursor: next } });
      return true;
    }

    const postMatch = /^\/posts\/([^/]+)(\/retry|\/unpublish)?$/.exec(path);
    if (!postMatch) return false;
    const post = this.posts.get(decodeURIComponent(postMatch[1] ?? ''));
    const action = postMatch[2];
    if (!post) return (fail(res, 404, 'not_found', 'post_not_found', 'Resource not found'), true);

    if (!action && method === 'GET') return (json(res, 200, { post: this.#publicPost(post) }), true);
    if (!action && method === 'PUT') {
      const body = await readBody(req);
      this.postRequests.push({ method, path, body, headers: req.headers });
      if (!['draft', 'scheduled', 'failed', 'partial', 'cancelled'].includes(post.status)) return (fail(res, 400, 'invalid_request_error', 'post_not_editable', 'Published posts can only have their recycling config updated'), true);
      const invalid = this.#applyBody(post, body);
      if (invalid) return (fail(res, 400, 'invalid_request_error', invalid, 'Account not found in your team'), true);
      post.updatedAt = new Date().toISOString();
      if (body.isDraft === true) post.status = 'draft';
      else if (body.publishNow === true) this.#publish(post);
      else if (typeof body.scheduledFor === 'string' && (body.isDraft === false || post.status !== 'draft')) post.status = Date.parse(body.scheduledFor) <= Date.now() ? (this.#publish(post), post.status) : 'scheduled';
      this.#publishOutcome(res, post, 200);
      return true;
    }
    if (!action && method === 'DELETE') {
      this.postRequests.push({ method, path, body: {}, headers: req.headers });
      if (post.status === 'published') return (fail(res, 400, 'invalid_request_error', 'cannot_delete_published', 'Cannot delete published posts'), true);
      this.posts.delete(post._id);
      return (json(res, 200, { message: 'Post deleted' }), true);
    }
    if (action === '/retry' && method === 'POST') {
      this.postRequests.push({ method, path, body: {}, headers: req.headers });
      if (!['failed', 'partial'].includes(post.status)) return (fail(res, 400, 'invalid_request_error', 'invalid_state', 'Invalid state'), true);
      this.#publish(post, (target) => target.status === 'failed');
      if (post.status === 'published') return (json(res, 200, { message: 'Retry successful', post: this.#publicPost(post) }), true);
      return (json(res, 207, { message: 'Retry did not fully succeed', error: 'Some platforms failed', post: this.#publicPost(post) }), true);
    }
    if (action === '/unpublish' && method === 'POST') {
      const body = await readBody(req);
      this.postRequests.push({ method, path, body, headers: req.headers });
      const platform = String(body.platform ?? '');
      if (NO_UNPUBLISH.has(platform)) return (fail(res, 400, 'invalid_request_error', 'platform_not_supported', 'Platform not supported for deletion'), true);
      const target = post.platforms.find((item) => item.platform === platform && (!body.accountId || item.accountId === body.accountId));
      if (!target || target.status !== 'published') return (fail(res, 400, 'invalid_request_error', 'not_published', 'Post not published on that platform'), true);
      target.status = 'cancelled';
      if (post.platforms.every((item) => item.status === 'cancelled')) post.status = 'cancelled';
      post.updatedAt = new Date().toISOString();
      return (json(res, 200, { success: true, message: 'Post deleted from platform' }), true);
    }
    return false;
  }

  /** Lista da leitura da Inbox: só conversas de contas do perfil; sem conversas de teste, a contagem configurada (testes de Z1) */
  #inboxList(profileId: string, accountId: string | null) {
    const own = new Set([...this.accounts.values()].filter((account) => account.profileId === profileId).map((account) => account._id));
    // leakInboxThreads: devolve também conversas de outras contas (o DisparaZap precisa descartá-las)
    const threads = this.inboxThreads.filter((item) => own.has(item.accountId) && (this.leakInboxThreads || !accountId || item.accountId === accountId));
    if (threads.length) {
      return threads.map((item) => ({ id: item.id, platform: item.platform ?? 'instagram', accountId: item.accountId, participantName: item.participantName, lastMessage: item.lastMessage, updatedTime: item.updatedTime, status: item.status, unreadCount: item.unreadCount }));
    }
    return Array.from({ length: this.inboxConversations }, (_, index) => ({ id: `conv_sim_${index + 1}`, platform: 'instagram', accountId: null, participantName: null, lastMessage: null, updatedTime: null, status: 'active', unreadCount: null }));
  }

  #metrics(profileId: string | null) {
    const rows: { platform: string; date: string; publishedAt: string; content: string; url: string | undefined }[] = [];
    for (const post of this.posts.values()) {
      if (profileId && post.profileId !== profileId) continue;
      for (const target of post.platforms) {
        if (target.status === 'published' && target.publishedAt) rows.push({ platform: target.platform, date: target.publishedAt.slice(0, 10), publishedAt: target.publishedAt, content: post.content, url: target.platformPostUrl });
      }
    }
    return rows;
  }

  async #handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://simulador');
    // Endereço assinado do armazenamento: não usa a chave de API (a assinatura está no próprio endereço)
    if (url.pathname.startsWith('/uploads/') && req.method === 'PUT') {
      const bytes = await readRaw(req);
      this.uploads.push({ key: url.pathname.slice(1), contentType: req.headers['content-type'], bytes, authorization: req.headers.authorization });
      res.writeHead(200);
      res.end();
      return;
    }
    const path = url.pathname.replace(/^\/api\/v1/, '');
    const auth = req.headers.authorization ?? '';
    this.seenKeys.push(auth);
    const key = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!this.keys.has(key)) return fail(res, 401, 'authentication_error', key ? 'invalid_credentials' : 'missing_credentials', 'Invalid API key');
    if (this.failNext) {
      const { status, body, headers } = this.failNext;
      this.failNext = null;
      res.writeHead(status, { 'content-type': 'application/json', ...headers });
      res.end(JSON.stringify(body));
      return;
    }
    const method = req.method ?? 'GET';
    if (this.failRoute && this.failRoute.method === method && this.failRoute.path === path) {
      const { status, body, headers } = this.failRoute;
      this.failRoute = null;
      if (method !== 'GET') this.postRequests.push({ method, path, body: await readBody(req), headers: req.headers });
      res.writeHead(status, { 'content-type': 'application/json', ...headers });
      res.end(JSON.stringify(body));
      return;
    }

    if (await this.#handlePosts(req, res, url, path, method)) return;

    if (method === 'GET' && (path === '/analytics/daily-metrics' || path === '/analytics')) {
      if (this.analyticsLocked) return json(res, 402, { error: 'Analytics access required', code: 'analytics_access_required' });
      const rows = this.#metrics(url.searchParams.get('profileId'));
      const sum = (count: number) => Object.fromEntries(Object.entries(SIM_METRICS).map(([name, value]) => [name, value * count]));
      if (path === '/analytics') {
        const limit = Number(url.searchParams.get('limit') ?? 50);
        return json(res, 200, {
          overview: { totalPosts: rows.length, publishedPosts: rows.length, scheduledPosts: 0, lastSync: new Date().toISOString() },
          posts: rows.slice(0, limit).map((row) => ({ _id: this.#id('ext'), platform: row.platform, content: row.content, publishedAt: row.publishedAt, platformPostUrl: row.url, analytics: { ...SIM_METRICS, engagementRate: 2.1 } })),
          pagination: { page: 1, limit, total: rows.length, pages: 1 },
          hasAnalyticsAccess: true,
        });
      }
      const byDate = new Map<string, number>();
      const byPlatform = new Map<string, number>();
      for (const row of rows) {
        byDate.set(row.date, (byDate.get(row.date) ?? 0) + 1);
        byPlatform.set(row.platform, (byPlatform.get(row.platform) ?? 0) + 1);
      }
      return json(res, 200, {
        dailyData: [...byDate.entries()].map(([date, count]) => ({ date, postCount: count, platforms: {}, metrics: sum(count) })),
        platformBreakdown: [...byPlatform.entries()].map(([platform, count]) => ({ platform, postCount: count, ...sum(count) })),
        totals: { postCount: rows.length, ...sum(rows.length), engagement: (12 + 3 + 2 + 1) * rows.length },
      });
    }

    const boardsMatch = /^\/accounts\/([^/]+)\/pinterest-boards$/.exec(path);
    if (boardsMatch && method === 'GET') {
      const account = this.accounts.get(decodeURIComponent(boardsMatch[1] ?? ''));
      if (!account) return fail(res, 404, 'not_found', 'account_not_found', 'Account not found');
      if (account.platform !== 'pinterest') return fail(res, 400, 'invalid_request_error', 'not_pinterest_account', 'Not a Pinterest account');
      return json(res, 200, { boards: this.boards });
    }

    if (method === 'GET' && path === '/usage') {
      // Como na conta real observada em 2026-11-02: o /v1/usage respondeu 0 com 2 redes ativas (o DisparaZap não usa esse número)
      return json(res, 200, { billingSystem: 'metronome', planName: 'Usage-Based', hasAccess: true, limits: { uploads: -1, profiles: -1 }, usage: { connectedAccounts: 0, xApiCalls: {} } });
    }

    if (method === 'GET' && path === '/auth/verify') {
      return json(res, 200, { valid: true, userId: 'usr_simulado', name: this.accountName, email: 'conta@zernio.test', authType: 'api_key', scope: null });
    }

    if (path === '/profiles' && method === 'GET') {
      const externalId = url.searchParams.get('externalId');
      const profiles = [...this.profiles.values()].filter((profile) => externalId === null || profile.externalId === externalId);
      return json(res, 200, { profiles });
    }
    if (path === '/profiles' && method === 'POST') {
      const body = await readBody(req);
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const externalId = typeof body.externalId === 'string' ? body.externalId : null;
      if (!name) return fail(res, 400, 'invalid_request_error', 'validation_error', 'name is required', { field: 'name' });
      const byExternal = externalId ? [...this.profiles.values()].find((profile) => profile.externalId === externalId) : undefined;
      if (byExternal) return fail(res, 409, 'invalid_request_error', 'profile_external_id_conflict', 'externalId already used', { existingProfileId: byExternal._id });
      const byName = [...this.profiles.values()].find((profile) => profile.name === name);
      if (byName) return fail(res, 409, 'invalid_request_error', 'profile_name_conflict', 'name already used', { existingProfileId: byName._id });
      const profile: SimProfile = { _id: this.#id('prf'), name, externalId };
      this.profiles.set(profile._id, profile);
      return json(res, 201, { message: 'Profile created', profile: { ...profile, isDefault: false, accountCount: 0, createdAt: new Date().toISOString() } });
    }
    const profileMatch = /^\/profiles\/([^/]+)$/.exec(path);
    if (profileMatch && method === 'GET') {
      const profile = this.profiles.get(decodeURIComponent(profileMatch[1] ?? ''));
      return profile ? json(res, 200, { profile }) : fail(res, 404, 'not_found', 'profile_not_found', 'Profile not found');
    }

    const connectMatch = /^\/connect\/([^/]+)$/.exec(path);
    if (connectMatch && method === 'GET') {
      const platform = decodeURIComponent(connectMatch[1] ?? '');
      const query = Object.fromEntries(url.searchParams.entries());
      if (platform === 'snapchat') return fail(res, 403, 'permission_error', 'PLATFORM_BETA_RESTRICTED', 'Snapchat is in closed beta');
      if (platform === 'reddit') return fail(res, 503, 'api_error', 'PLATFORM_DISABLED', 'Reddit is temporarily unavailable');
      if (!query.profileId) return fail(res, 400, 'invalid_request_error', 'validation_error', 'profileId is required', { field: 'profileId' });
      if (!this.profiles.has(query.profileId)) return fail(res, 404, 'not_found', 'profile_not_found', 'Profile not found');
      if (this.enforceBilling && !this.hasPaymentMethod) {
        const billing = { code: 'PAYMENT_REQUIRED', documentation_url: 'https://docs.zernio.com/billing/payment-method-required', dashboard_url: 'https://zernio.com/dashboard/billing?add_payment_method=1' };
        if (platform === 'twitter') {
          return json(res, 402, { error: 'X (Twitter) requires a payment method due to API pass-through costs.', reason: 'twitter_passthrough', ...billing, details: { has_payment_method: false } });
        }
        if (!query.reconnectAccountId && this.accounts.size >= 2) {
          return json(res, 402, { error: 'Add a payment method to connect more than 2 accounts.', reason: 'free_tier_exceeded', ...billing, details: { free_tier_account_limit: 2, current_account_count: this.accounts.size, has_payment_method: false } });
        }
      }
      if (query.redirect_url) {
        try {
          if (!/^https?:$/.test(new URL(query.redirect_url).protocol)) throw new Error('scheme');
        } catch {
          return fail(res, 400, 'invalid_request_error', 'INVALID_REDIRECT_URL', 'redirect_url must be absolute');
        }
      }
      this.connectRequests.push({ platform, query });
      const state = randomUUID();
      return json(res, 200, { authUrl: `https://autorizacao.zernio.test/oauth/${platform}?state=${state}`, state });
    }

    if (path === '/comment-automations' && method === 'GET') {
      const profileId = url.searchParams.get('profileId');
      this.automationRequests.push(profileId);
      if (this.automationsMode === 'forbidden') return fail(res, 403, 'permission_error', 'forbidden', 'Not allowed for this key');
      if (this.automationsMode === 'server') return fail(res, 503, 'api_error', 'service_unavailable', 'Temporarily unavailable');
      if (this.automationsMode === 'odd') return json(res, 200, { success: true, items: [] });
      const automations = this.commentAutomations.filter((item) => this.leakAutomations || !profileId || item.profileId === profileId);
      return json(res, 200, { success: true, automations });
    }
    if (path === '/comment-automations' && method === 'POST') {
      const body = await readBody(req);
      this.automationWrites.push({ method, id: null, body });
      const refused = this.automationRefusal(body, true);
      if (refused) return refused(res);
      if (this.automationWriteMode === 'odd') return json(res, 200, { success: true });
      const automation: SimCommentAutomation = {
        ...body,
        id: `ca_sim_${++this.automationSeq}`,
        profileId: String(body.profileId),
        accountId: String(body.accountId),
        stats: { triggered: 0, dmsSent: 0, dmsFailed: 0, uniqueContacts: 0, linkClicks: 0 },
        createdAt: new Date().toISOString(),
      };
      this.commentAutomations.push(automation);
      return json(res, 200, { success: true, automation });
    }
    const logsMatch = /^\/comment-automations\/([^/]+)\/logs$/.exec(path);
    if (logsMatch && method === 'GET') {
      if (this.automationsMode === 'forbidden') return fail(res, 403, 'permission_error', 'forbidden', 'Not allowed for this key');
      if (this.automationsMode === 'server') return fail(res, 503, 'api_error', 'service_unavailable', 'Temporarily unavailable');
      const automationId = decodeURIComponent(logsMatch[1] ?? '');
      const logs = this.automationLogs.get(automationId) ?? [];
      const limit = Number(url.searchParams.get('limit') ?? 50);
      const skip = Number(url.searchParams.get('skip') ?? 0);
      return json(res, 200, {
        success: true,
        logs: logs.slice(skip, skip + limit),
        pagination: { total: logs.length, limit, skip, hasMore: skip + limit < logs.length },
        misses: { total: this.automationMisses.length, retentionDays: 7, samples: this.automationMisses.slice(0, 5) },
      });
    }
    const automationMatch = /^\/comment-automations\/([^/]+)$/.exec(path);
    if (automationMatch) {
      const automationId = decodeURIComponent(automationMatch[1] ?? '');
      const index = this.commentAutomations.findIndex((item) => item.id === automationId);
      const automation = this.commentAutomations[index];
      if (method === 'GET') {
        if (!automation) return fail(res, 404, 'not_found', 'automation_not_found', 'Automation not found');
        return json(res, 200, { success: true, automation });
      }
      if (method === 'PATCH' || method === 'DELETE') {
        const body = method === 'PATCH' ? await readBody(req) : {};
        this.automationWrites.push({ method, id: automationId, body });
        if (!automation) return fail(res, 404, 'not_found', 'automation_not_found', 'Automation not found');
        const refused = this.automationRefusal({ ...automation, ...body }, false);
        if (refused) return refused(res);
        if (method === 'DELETE') {
          this.commentAutomations.splice(index, 1);
          return json(res, 200, { success: true });
        }
        const updated: SimCommentAutomation = { ...automation, ...body, id: automation.id, profileId: automation.profileId, accountId: automation.accountId };
        this.commentAutomations[index] = updated;
        // Sem a automação na resposta, o DisparaZap relê pelo GET (o formato da resposta não está documentado)
        return this.automationWriteMode === 'odd' ? json(res, 200, { success: true }) : json(res, 200, { success: true, automation: updated });
      }
    }

    if (path === '/workflows' && method === 'GET') {
      if (this.automationsMode === 'forbidden') return fail(res, 403, 'permission_error', 'forbidden', 'Not allowed for this key');
      if (this.automationsMode === 'server') return fail(res, 503, 'api_error', 'service_unavailable', 'Temporarily unavailable');
      const profileId = url.searchParams.get('profileId');
      const workflows = this.workflows.filter((item) => !profileId || item.profileId === profileId).map((item) => this.workflowSummary(item));
      return json(res, 200, { success: true, workflows, pagination: { total: workflows.length, limit: 50, skip: 0, hasMore: false } });
    }
    if (path === '/workflows' && method === 'POST') {
      const body = await readBody(req);
      this.workflowWrites.push({ method, path, body });
      if (this.automationWriteMode === 'invalid') return fail(res, 400, 'invalid_request_error', 'invalid_field_value', 'Field rejected by the platform', { param: 'nodes' });
      if (this.automationWriteMode === 'server') return fail(res, 503, 'api_error', 'service_unavailable', 'Temporarily unavailable');
      const account = this.accounts.get(String(body.accountId ?? ''));
      if (!account || account.profileId !== body.profileId) return fail(res, 404, 'not_found', 'account_not_found', 'Account not found');
      if (body.platform !== account.platform) return fail(res, 400, 'invalid_request_error', 'validation_error', 'platform does not match the account', { field: 'platform' });
      const workflow: SimWorkflow = {
        id: `wf_sim_${++this.workflowSeq}`,
        profileId: String(body.profileId),
        accountId: account._id,
        platform: account.platform,
        name: String(body.name ?? ''),
        description: typeof body.description === 'string' ? body.description : undefined,
        nodes: Array.isArray(body.nodes) ? body.nodes : [],
        edges: Array.isArray(body.edges) ? body.edges : [],
        status: 'draft',
      };
      this.workflows.push(workflow);
      return json(res, 201, { success: true, workflow: this.workflowSummary(workflow) });
    }
    const workflowMatch = /^\/workflows\/([^/]+)(\/(activate|pause))?$/.exec(path);
    if (workflowMatch) {
      const workflowId = decodeURIComponent(workflowMatch[1] ?? '');
      const action = workflowMatch[3];
      const index = this.workflows.findIndex((item) => item.id === workflowId);
      const workflow = this.workflows[index];
      if (method === 'POST' && action) {
        this.workflowWrites.push({ method, path, body: {} });
        if (!workflow) return fail(res, 404, 'not_found', 'workflow_not_found', 'Workflow not found');
        if (this.automationWriteMode === 'server') return fail(res, 503, 'api_error', 'service_unavailable', 'Temporarily unavailable');
        workflow.status = action === 'activate' ? 'active' : 'paused';
        return json(res, 200, { success: true, workflow: { id: workflow.id, status: workflow.status } });
      }
      if (method === 'DELETE' && !action) {
        this.workflowWrites.push({ method, path, body: {} });
        if (!workflow) return fail(res, 404, 'not_found', 'workflow_not_found', 'Workflow not found');
        this.workflows.splice(index, 1);
        return json(res, 200, { success: true });
      }
    }

    if (path === '/inbox/conversations' && method === 'GET') {
      const profileId = url.searchParams.get('profileId') ?? '';
      this.inboxRequests.push({ profileId, limit: url.searchParams.get('limit') });
      if (!profileId) return fail(res, 400, 'invalid_request_error', 'validation_error', 'profileId is required', { field: 'profileId' });
      if (!this.profiles.has(profileId)) return fail(res, 404, 'not_found', 'profile_not_found', 'Profile not found');
      switch (this.inboxMode) {
        case 'unauthorized':
          return fail(res, 401, 'authentication_error', 'invalid_credentials', 'Invalid API key');
        case 'addon':
          return fail(res, 403, 'permission_error', 'feature_not_available', 'Inbox addon required');
        case 'forbidden':
          return fail(res, 403, 'permission_error', 'forbidden', 'Forbidden');
        case 'payment':
          return fail(res, 402, 'payment_error', 'PAYMENT_REQUIRED', 'Payment required');
        case 'rate_limit':
          return fail(res, 429, 'rate_limit_error', 'rate_limited', 'Too many requests');
        case 'server':
          return fail(res, 500, 'api_error', 'internal_error', 'Internal error');
        case 'odd':
          return json(res, 200, { ok: true, items: 'formato inesperado' });
        default:
          // Só o formato da lista; nenhum texto de mensagem existe no simulador
          // Formato da documentação: "data" (lista), "pagination" e "meta"
          return json(res, 200, {
            data: this.#inboxList(profileId, url.searchParams.get('accountId')),
            pagination: { hasMore: false, nextCursor: null },
            meta: { accountsQueried: 1, accountsFailed: 0, failedAccounts: [], lastUpdated: new Date().toISOString(), accountsSkipped: [] },
          });
      }
    }

    const sendMatch = /^\/inbox\/conversations\/([^/]+)\/messages$/.exec(path);
    if (sendMatch && method === 'POST') {
      const body = await readBody(req);
      const conversationId = decodeURIComponent(sendMatch[1] ?? '');
      const key = String(req.headers['idempotency-key'] ?? '');
      const accountId = typeof body.accountId === 'string' ? body.accountId : '';
      const message = typeof body.message === 'string' ? body.message : '';
      if (!key) return fail(res, 400, 'invalid_request_error', 'validation_error', 'Idempotency-Key is required', { field: 'Idempotency-Key' });
      if (!accountId || !message) return fail(res, 400, 'invalid_request_error', 'validation_error', 'accountId and message are required');
      const bodyText = JSON.stringify(body);
      const earlier = this.sendReplies.get(key);
      if (earlier) {
        if (earlier.body !== bodyText) return fail(res, 422, 'invalid_request_error', 'attachment_fetch_failed', 'Idempotency-Key reused with a different request');
        res.writeHead(earlier.status, { 'content-type': 'application/json', 'idempotent-replayed': 'true' });
        res.end(JSON.stringify(earlier.response));
        return;
      }
      if (![...this.accounts.values()].some((account) => account._id === accountId)) return fail(res, 404, 'not_found', 'account_not_found', 'Account not found');
      const record = () => this.sentMessages.push({ conversationId, accountId, message, messageTag: typeof body.messageTag === 'string' ? body.messageTag : undefined, messagingType: typeof body.messagingType === 'string' ? body.messagingType : undefined, idempotencyKey: key });
      switch (this.sendMode) {
        case '409':
          return fail(res, 409, 'api_error', 'idempotency_in_progress', 'The same Idempotency-Key is still processing. Retry after a short backoff.');
        case '422':
          return fail(res, 422, 'invalid_request_error', 'attachment_fetch_failed', 'Nothing was sent.');
        case '429':
          return fail(res, 429, 'rate_limit_error', 'rate_limited', 'Rate limited. No message was sent.');
        case '500':
          return fail(res, 500, 'api_error', 'internal_error', 'The platform rejected or failed the send.');
        case '502':
          return fail(res, 502, 'api_error', 'upstream_error', 'Upstream failure.');
        case 'janela':
          return fail(res, 403, 'platform_error', 'platform_api_error', 'Meta rejected the send outside the messaging window.');
        case 'sem_id':
          record();
          return json(res, 200, { success: true, data: { conversationId } });
        default: {
          const response = { success: true, data: { messageId: `mid_sim_${this.sentMessages.length + 1}`, conversationId, attachments: [] } };
          record();
          this.sendReplies.set(key, { body: bodyText, status: 200, response });
          return json(res, 200, response);
        }
      }
    }

    const threadMatch = /^\/inbox\/conversations\/([^/]+)\/messages$/.exec(path);
    if (threadMatch && method === 'GET') {
      const conversationId = decodeURIComponent(threadMatch[1] ?? '');
      const accountId = url.searchParams.get('accountId');
      if (!accountId) return fail(res, 400, 'invalid_request_error', 'validation_error', 'accountId is required', { field: 'accountId' });
      const thread = this.inboxThreads.find((item) => item.id === conversationId && item.accountId === accountId);
      if (!thread || ![...this.accounts.values()].some((account) => account._id === accountId)) return fail(res, 404, 'not_found', 'conversation_not_found', 'Conversation not found');
      const sortOrder = !this.ignoreSortOrder && url.searchParams.get('sortOrder') === 'desc' ? 'desc' : 'asc';
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? 100) || 100));
      const cursor = url.searchParams.get('cursor');
      const start = cursor === null ? 0 : Number(cursor);
      if (!Number.isInteger(start) || start < 0) return fail(res, 400, 'invalid_request_error', 'invalid_cursor', 'Invalid cursor');
      const ordered = [...thread.messages].sort((a, b) => (sortOrder === 'desc' ? b.createdAt.localeCompare(a.createdAt) : a.createdAt.localeCompare(b.createdAt)));
      const page = ordered.slice(start, start + limit);
      const hasMore = start + limit < ordered.length;
      return json(res, 200, {
        status: 'success',
        sortOrderApplied: sortOrder,
        messages: page.map((item) => ({ id: item.id, conversationId, accountId, platform: 'instagram', direction: item.direction, message: item.message, createdAt: item.createdAt, attachments: item.attachments ?? [], noRenderableContent: item.message === null && (item.attachments ?? []).length === 0 })),
        pagination: { hasMore, nextCursor: hasMore ? String(start + limit) : null },
      });
    }

    if (path === '/accounts/health' && method === 'GET') {
      const profileId = url.searchParams.get('profileId');
      const list = [...this.accounts.values()].filter((account) => !profileId || account.profileId === profileId);
      const accounts = list.map((account) => ({
        accountId: account._id,
        platform: account.platform,
        username: account.username,
        profileId: account.profileId,
        status: account.needsReconnection ? 'error' : 'healthy',
        canPost: !account.needsReconnection,
        tokenValid: !account.needsReconnection,
        needsReconnect: account.needsReconnection,
        issues: account.needsReconnection ? ['token_expired'] : [],
      }));
      const unhealthy = accounts.filter((account) => account.needsReconnect).length;
      return json(res, 200, { summary: { total: accounts.length, healthy: accounts.length - unhealthy, warning: 0, error: unhealthy, needsReconnect: unhealthy }, accounts });
    }
    if (path === '/accounts' && method === 'GET') {
      const profileId = url.searchParams.get('profileId');
      const status = url.searchParams.get('status');
      if (!profileId && this.teamListUnavailable) return fail(res, 500, 'api_error', 'internal_error', 'Accounts unavailable');
      const accounts = [...this.accounts.values()]
        .filter((account) => this.leakAllAccounts || !profileId || account.profileId === profileId)
        .filter((account) => status !== 'connected' || account.isActive);
      return json(res, 200, { accounts, hasAnalyticsAccess: true });
    }
    const accountMatch = /^\/accounts\/([^/]+)$/.exec(path);
    if (accountMatch && method === 'DELETE') {
      const id = decodeURIComponent(accountMatch[1] ?? '');
      if (!this.accounts.delete(id)) return fail(res, 404, 'not_found', 'account_not_found', 'Account not found');
      this.deleted.push(id);
      return json(res, 200, { message: 'Account disconnected' });
    }

    return fail(res, 404, 'not_found', 'route_not_found', 'Not found');
  }
}
