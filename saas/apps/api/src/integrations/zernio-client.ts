import { z } from 'zod';
import { httpRequest, type HttpMethod, type HttpResponse } from './evolution-client.ts';

/**
 * Adaptador da API da Zernio (redes sociais), só com as rotas que o DisparaZap usa (REFERENCIA_ZERNIO.md).
 * Endereço fixo: a empresa informa só a chave, nunca uma URL (o DisparaZap não vira ponte para outros endereços).
 * TLS sempre verificado, sem seguir redirecionamentos (a chave vai no cabeçalho) e com tempo-limite (httpRequest).
 */
export const ZERNIO_API_BASE = 'https://zernio.com/api/v1';
const TIMEOUT_MS = 15_000;
/** Publicar na hora é síncrono na Zernio (envia para cada rede dentro do pedido): espera mais */
const PUBLISH_TIMEOUT_MS = 120_000;
/** Envio de um arquivo para o armazenamento da Zernio (até 5 MB nesta etapa) */
const UPLOAD_TIMEOUT_MS = 60_000;

export type ZernioErrorKind = 'unauthorized' | 'forbidden' | 'payment_required' | 'rate_limited' | 'not_found' | 'conflict' | 'platform_unavailable' | 'invalid' | 'unreachable' | 'failed';

/** Mensagens fixas para a tela: nunca o texto da Zernio (que muda entre versões e pode trazer detalhes internos) */
const MESSAGES: Readonly<Record<ZernioErrorKind, string>> = {
  unauthorized: 'A Zernio recusou a chave de API. Confira a chave ou crie uma nova no painel da Zernio.',
  forbidden: 'A chave da Zernio não tem permissão para isso. Confira as permissões da chave no painel da Zernio.',
  payment_required: 'A Zernio pediu pagamento ou cartão para continuar (limite grátis atingido, o X exige cartão ou a conta está pausada). Resolva no painel da Zernio.',
  rate_limited: 'A Zernio pediu uma pausa por excesso de pedidos. Tente de novo em instantes.',
  not_found: 'A Zernio não encontrou o que foi pedido.',
  conflict: 'A Zernio informou um conflito com um registro que já existe.',
  platform_unavailable: 'Esta rede está indisponível na Zernio no momento.',
  invalid: 'A Zernio não aceitou o pedido.',
  unreachable: 'A Zernio não respondeu. Tente de novo em instantes.',
  failed: 'A Zernio não conseguiu atender o pedido agora. Tente de novo em instantes.',
};

export class ZernioError extends Error {
  readonly kind: ZernioErrorKind;
  readonly httpStatus: number | null;
  /** Código da Zernio (ex.: profile_external_id_conflict), para decidir; nunca mostrado na tela */
  readonly code: string | null;
  readonly details: Readonly<Record<string, unknown>> | null;
  /** Motivo da Zernio no 402 (free_tier_exceeded, twitter_passthrough, card_verification_required, enterprise_required) */
  readonly reason: string | null;
  /** Segundos pedidos pela Zernio no 429 (cabeçalho Retry-After) */
  readonly retryAfterSeconds: number | null;
  constructor(
    kind: ZernioErrorKind,
    httpStatus: number | null = null,
    code: string | null = null,
    details: Record<string, unknown> | null = null,
    reason: string | null = null,
    retryAfterSeconds: number | null = null,
  ) {
    super(MESSAGES[kind]);
    this.name = 'ZernioError';
    this.kind = kind;
    this.httpStatus = httpStatus;
    this.code = code;
    this.details = details;
    this.reason = reason;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface ZernioProfile {
  id: string;
  name: string;
  externalId: string | null;
}

export interface ZernioAccountInfo {
  id: string;
  platform: string;
  /** Perfil a que a conta pertence (a Zernio pode mandar o id ou o perfil inteiro) */
  profileId: string | null;
  username: string | null;
  displayName: string | null;
  profileUrl: string | null;
  isActive: boolean;
  needsReconnection: boolean;
}

export interface ZernioAccountHealth {
  accountId: string;
  /** healthy | warning | error (pode vir outro valor em versões novas) */
  status: string | null;
  needsReconnect: boolean;
  tokenValid: boolean | null;
}

export interface ZernioClient {
  /** GET /v1/auth/verify: confere a chave sem ler dados */
  verify(): Promise<{ name: string | null }>;
  findProfileByExternalId(externalId: string): Promise<ZernioProfile | null>;
  getProfile(profileId: string): Promise<ZernioProfile | null>;
  createProfile(input: { name: string; externalId: string; description: string }): Promise<ZernioProfile>;
  /** GET /v1/connect/{platform}: endereço de autorização (só https) */
  connectUrl(input: { platform: string; profileId: string; redirectUrl: string; reconnectAccountId: string | null }): Promise<string>;
  listAccounts(profileId: string): Promise<ZernioAccountInfo[]>;
  accountsHealth(profileId: string): Promise<ZernioAccountHealth[]>;
  deleteAccount(accountId: string): Promise<void>;
  /** GET /v1/accounts?status=connected sem perfil: redes conectadas na conta Zernio inteira (todos os perfis) */
  listTeamAccounts(): Promise<ZernioAccountInfo[]>;
  /** GET /v1/profiles: perfis da conta (para dar nome ao perfil de cada rede) */
  listProfiles(): Promise<ZernioProfile[]>;
  /** Leitura de teste do inbox (1 conversa no máximo): só diz se a Zernio respondeu e se há conversas; null = resposta fora do formato */
  inboxProbe(profileId: string): Promise<{ conversations: number | null; keys: string[] }>;
  /** Conversas (lista da Zernio, mais recentes primeiro). profileId filtra pelo perfil da empresa; accountId opcional */
  listInboxConversations(input: { profileId: string; accountId: string | null; platform: string; cursor: string | null; limit: number }): Promise<ZernioInboxPage<ZernioInboxConversationRaw>>;
  /** Mensagens de uma conversa (accountId obrigatório na Zernio). Só leitura */
  listInboxMessages(input: { conversationId: string; accountId: string; cursor: string | null; limit: number; sortOrder: 'asc' | 'desc' }): Promise<ZernioInboxPage<ZernioInboxMessageRaw>>;
  /** Envio de resposta (Z3.2). Só com os campos documentados; a chave de idempotência é a mesma para a mesma intenção */
  sendInboxMessage(conversationId: string, input: ZernioInboxSendInput, idempotencyKey: string): Promise<{ messageId: string | null }>;

  // ----- Publicações (módulo Redes Sociais; PLANO_MODULO_REDES_SOCIAIS §B.1) -----
  /** POST /v1/media/presign + PUT do arquivo no endereço assinado: devolve o endereço público para usar no post */
  uploadImage(input: { fileName: string; contentType: string; bytes: Uint8Array }): Promise<string>;
  /** POST /v1/posts com Idempotency-Key (repetir com a mesma chave nunca cria outro post) */
  createPost(body: ZernioPostBody, idempotencyKey: string): Promise<ZernioPublishResult>;
  getPost(postId: string): Promise<ZernioPost>;
  updatePost(postId: string, body: ZernioPostBody): Promise<ZernioPublishResult>;
  deletePost(postId: string): Promise<void>;
  /** Tenta de novo só as redes que falharam */
  retryPost(postId: string): Promise<ZernioPost | null>;
  unpublishPost(postId: string, input: { platform: string; accountId: string }): Promise<void>;
  /** PUT /v1/posts/{id} só com o horário: o resto do post (redes, opções) fica como está */
  reschedulePost(postId: string, input: { scheduledFor: string; timezone: string }): Promise<ZernioPost>;
  /** GET /v1/posts do perfil, só o que mudou desde updatedSince (sincronização incremental) */
  listPosts(input: { profileId: string; updatedSince: string; cursor: string | null }): Promise<{ posts: ZernioPost[]; nextCursor: string | null }>;
  dailyMetrics(input: { profileId: string; fromDate: string; toDate: string }): Promise<ZernioDailyMetrics>;
  postMetrics(input: { profileId: string; fromDate: string; toDate: string; limit: number }): Promise<ZernioPostMetrics[]>;
  pinterestBoards(accountId: string): Promise<{ id: string; name: string }[]>;

  // ----- Automações (PLANO_MODULO_AUTOMACOES; etapa A1: só leitura) -----
  /** GET /v1/comment-automations?profileId=: automações do perfil (a conta de cada uma é conferida no serviço) */
  listCommentAutomations(profileId: string): Promise<ZernioCommentAutomation[]>;
  /** GET /v1/comment-automations/{id}: uma automação */
  getCommentAutomation(automationId: string): Promise<ZernioCommentAutomation>;
  /** POST /v1/comment-automations (etapa A2). A documentação não cita Idempotency-Key: o serviço evita duplicar pelo nome */
  createCommentAutomation(body: ZernioCommentAutomationBody & { profileId: string; accountId: string; isActive: boolean }): Promise<ZernioCommentAutomation>;
  /** PATCH /v1/comment-automations/{id}: só os campos enviados mudam. null = a Zernio não devolveu a automação */
  updateCommentAutomation(automationId: string, body: Partial<ZernioCommentAutomationBody> & { isActive?: boolean }): Promise<ZernioCommentAutomation | null>;
  /** DELETE /v1/comment-automations/{id} */
  deleteCommentAutomation(automationId: string): Promise<void>;
  /** GET /v1/comment-automations/{id}/logs (A4): registros de envio e comentários que não casaram (misses) */
  listCommentAutomationLogs(automationId: string, input: { limit: number; skip: number }): Promise<ZernioAutomationLogs>;

  // ----- Fluxos de link (PLANO_MODULO_AUTOMACOES, A5; documentação de workflows lida em 2026-11-05) -----
  /** GET /v1/workflows?profileId=: fluxos do perfil (a conta de cada um é conferida no serviço) */
  listWorkflows(profileId: string): Promise<ZernioWorkflow[]>;
  /** POST /v1/workflows: o fluxo nasce como rascunho e só é ativado por outra ação */
  createWorkflow(body: ZernioWorkflowBody): Promise<ZernioWorkflow>;
  /** POST /v1/workflows/{id}/activate ou /pause */
  setWorkflowActive(workflowId: string, active: boolean): Promise<ZernioWorkflow>;
  /** DELETE /v1/workflows/{id}: apaga o fluxo e todas as conversas dele */
  deleteWorkflow(workflowId: string): Promise<void>;
}

/** Um registro de automação como a Zernio informa (campos que a tela não usa ficam de fora) */
export interface ZernioAutomationLog {
  id: string;
  status: string;
  source: string | null;
  error: string | null;
  clickCount: number;
  createdAt: string | null;
  commentText: string | null;
  commenterName: string | null;
  commenterUsername: string | null;
}

/** Comentários que chegaram à automação e não casaram com nenhuma palavra-chave (retidos por um prazo curto) */
export interface ZernioAutomationMisses {
  total: number;
  samples: { commentText: string | null; commenterName: string | null; excludedBy: string | null; at: string | null }[];
}

export interface ZernioAutomationLogs {
  logs: ZernioAutomationLog[];
  total: number;
  misses: ZernioAutomationMisses | null;
}

/** Fluxo de link: um gatilho de referência (ig.me/m/<conta>?ref=…) que envia uma mensagem e marca a pessoa */
export interface ZernioWorkflowNode {
  id: string;
  type: 'trigger' | 'send_message' | 'wait_for_reply' | 'add_tag' | 'end';
  config?: Record<string, unknown>;
}

export interface ZernioWorkflowBody {
  profileId: string;
  accountId: string;
  platform: 'instagram';
  name: string;
  description: string;
  nodes: ZernioWorkflowNode[];
  /** sourceHandle escolhe a saída de uma espera (reply ou timeout); sem ele, a saída padrão */
  edges: { id: string; source: string; target: string; sourceHandle?: string }[];
}

/** Fluxo como a lista da Zernio devolve (o grafo não vem na lista; o código do link fica na descrição) */
export interface ZernioWorkflow {
  id: string;
  name: string;
  description: string | null;
  accountId: string | null;
  status: string;
  nodeCount: number;
  totalStarted: number;
  totalCompleted: number;
}

/** Campos enviados ao criar ou alterar uma automação de comentário (só os documentados) */
export interface ZernioCommentAutomationBody {
  name: string;
  trigger: 'comment' | 'story_mention';
  keywords: string[];
  /** Ausente na menção em story (sem palavra-chave) */
  matchMode?: 'word' | 'contains' | 'exact';
  repeatPolicy: { mode: 'once' } | { mode: 'every_comment'; cooldownHours: number };
  dmMessage?: string;
  buttons?: { type: 'url'; title: string; url: string }[];
  commentReply?: string | null;
  publicReplyPolicy?: 'after_dm' | 'always';
  alsoMatchInDms?: boolean;
  /** Só seguidores (A3): follower + verify; 'any' desliga a verificação numa edição */
  audience?: { followerStatus: 'follower' | 'any'; whenUnknown: 'verify' | 'send' };
  followGate?: { message: string; buttonLabel: string; notFollowingMessage: string };
}

/**
 * Automação de comentário como a Zernio informa (documentação oficial de comment-automations, lida em 2026-11-05).
 * A documentação não traz a resposta completa: campos ausentes viram null ou o padrão da Zernio, e o formato real é
 * conferido na homologação H1. Sem id ou sem conta, a automação é descartada (nunca mostrada a uma empresa por engano).
 */
export interface ZernioCommentAutomation {
  id: string;
  name: string;
  platform: string | null;
  accountId: string | null;
  trigger: string;
  keywords: string[];
  matchMode: string | null;
  platformPostId: string | null;
  postTitle: string | null;
  isActive: boolean;
  repeatMode: 'once' | 'every_comment';
  cooldownHours: number | null;
  followersOnly: boolean;
  /** Mensagem de verificação de seguidor (só com followersOnly) */
  followGate: { message: string; buttonLabel: string; notFollowingMessage: string } | null;
  dmMessage: string | null;
  buttons: { type: string; title: string; url: string | null }[];
  commentReply: string | null;
  publicReplyPolicy: string | null;
  alsoMatchInDms: boolean;
  stats: { triggered: number; dmsSent: number; dmsFailed: number; uniqueContacts: number; linkClicks: number; followGateSent: number; followGatePassed: number };
  createdAt: string | null;
}

/** Uma rede de destino de um post, como a Zernio informa (o texto de erro da rede não é lido: só a categoria) */
export interface ZernioPostTarget {
  platform: string;
  accountId: string;
  accountUsername: string | null;
  accountDisplayName: string | null;
  status: string;
  platformPostUrl: string | null;
  publishedAt: string | null;
  errorCategory: string | null;
  /** platformSpecificData.contentType (story, reel) */
  contentType: string | null;
  customContent: string | null;
  /** Opções do pin (platformSpecificData), só no Pinterest */
  pinterest: { title: string | null; link: string | null; boardId: string | null } | null;
}

export interface ZernioPost {
  id: string;
  status: string;
  content: string;
  scheduledFor: string | null;
  timezone: string | null;
  mediaUrls: string[];
  targets: ZernioPostTarget[];
  createdAt: string | null;
  updatedAt: string | null;
}

/** Corpo de POST/PUT /v1/posts, só com os campos que o DisparaZap usa (nomes exatos: a Zernio ignora nome errado) */
export interface ZernioPostBody {
  content: string;
  mediaItems: { type: 'image'; url: string }[];
  platforms: { platform: string; accountId: string; customContent?: string; platformSpecificData?: Record<string, unknown> }[];
  timezone: string;
  publishNow?: boolean;
  scheduledFor?: string;
  isDraft?: boolean;
}

export interface ZernioPublishResult {
  post: ZernioPost;
  /** 207: o post foi salvo, mas a publicação na hora não saiu em todas as redes */
  partial: boolean;
  /** 200 no POST: a Zernio devolveu o post de um pedido anterior com a mesma Idempotency-Key */
  replayed: boolean;
}

export const ZERNIO_METRICS = ['impressions', 'reach', 'likes', 'comments', 'shares', 'saves', 'clicks', 'views'] as const;
export type ZernioMetrics = Record<(typeof ZERNIO_METRICS)[number], number>;

export interface ZernioDailyMetrics {
  postCount: number;
  totals: ZernioMetrics;
  byPlatform: { platform: string; postCount: number; metrics: ZernioMetrics }[];
  daily: { date: string; postCount: number; metrics: ZernioMetrics }[];
}

export interface ZernioPostMetrics {
  platform: string;
  content: string;
  publishedAt: string | null;
  platformPostUrl: string | null;
  metrics: ZernioMetrics;
}

/** A partir da chave de uma empresa (os testes trocam por um cliente apontando para a Zernio simulada) */
export type ZernioClientFactory = (apiKey: string) => ZernioClient;

/** Formas lidas da Zernio para a Inbox de redes (só os campos usados; o resto é ignorado) */
export interface ZernioInboxConversationRaw {
  id: string;
  platform: string | null;
  accountId: string | null;
  participantName: string | null;
  lastMessage: string | null;
  updatedTime: string | null;
  status: string | null;
  unreadCount: number | null;
}
export interface ZernioInboxMessageRaw {
  id: string;
  direction: 'incoming' | 'outgoing';
  message: string | null;
  attachmentTypes: string[];
  createdAt: string | null;
  sentAt: string | null;
}
export interface ZernioInboxSendInput {
  accountId: string;
  message: string;
  /** Só para resposta humana fora de 24 horas */
  messageTag?: 'HUMAN_AGENT';
  messagingType?: 'MESSAGE_TAG';
}
export interface ZernioInboxPage<T> {
  items: T[];
  hasMore: boolean;
  nextCursor: string | null;
  sortOrderApplied?: string | null;
}

// ----- Leitura tolerante das respostas: só os campos usados; o resto é ignorado -----
const text = z.string().trim().max(500);
const profileShape = z.looseObject({ _id: z.string().min(1), name: z.string().default(''), externalId: z.string().nullish() });
const verifyShape = z.looseObject({ name: z.string().nullish() });
const profilesShape = z.looseObject({ profiles: z.array(profileShape) });
/** Lista do inbox: só a contagem importa; o conteúdo de cada conversa não é lido */
// Documentação oficial (messages/list-inbox-conversations): a lista vem em "data", com "pagination" e "meta"
const inboxProbeShape = z.looseObject({ data: z.array(z.unknown()) });
const inboxPaginationShape = z.looseObject({ hasMore: z.boolean().nullish(), nextCursor: z.string().nullish() }).nullish();
const inboxConversationShape = z.looseObject({
  id: z.string(),
  platform: z.string().nullish(),
  accountId: z.string().nullish(),
  participantName: z.string().nullish(),
  lastMessage: z.string().nullish(),
  updatedTime: z.string().nullish(),
  status: z.string().nullish(),
  unreadCount: z.number().int().nullish(),
});
const inboxConversationsPageShape = z.looseObject({ data: z.array(inboxConversationShape), pagination: inboxPaginationShape });
const inboxMessageShape = z.looseObject({ id: z.string(), direction: z.enum(['incoming', 'outgoing']), message: z.string().nullish(), createdAt: z.string().nullish(), sentAt: z.string().nullish(), attachments: z.array(z.unknown()).nullish() });
const sendReplyShape = z.looseObject({ success: z.boolean().nullish(), data: z.looseObject({ messageId: z.string().nullish() }).nullish() });
const inboxMessagesPageShape = z.looseObject({ messages: z.array(inboxMessageShape), pagination: inboxPaginationShape, sortOrderApplied: z.string().nullish() });
/** Tipo de cada anexo; o que não for texto conhecido vira "unsupported_type" (nunca o conteúdo) */
const KNOWN_ATTACHMENT_TYPES = new Set(['image', 'video', 'audio', 'file', 'sticker', 'share', 'template', 'unsupported_type']);
const attachmentType = (item: unknown): string => {
  const type = item !== null && typeof item === 'object' ? (item as { type?: unknown }).type : undefined;
  return typeof type === 'string' && KNOWN_ATTACHMENT_TYPES.has(type) ? type : 'unsupported_type';
};
const inboxPage = (pagination: z.infer<typeof inboxPaginationShape>) => ({ hasMore: pagination?.hasMore ?? false, nextCursor: pagination?.nextCursor ?? null });
const oneProfileShape = z.looseObject({ profile: profileShape });
const connectShape = z.looseObject({ authUrl: z.string() });
const accountShape = z.looseObject({
  _id: z.string().min(1),
  platform: z.string().default(''),
  profileId: z.union([z.string(), z.looseObject({ _id: z.string() })]).nullish(),
  username: text.nullish(),
  displayName: text.nullish(),
  profileUrl: z.string().nullish(),
  isActive: z.boolean().optional(),
  needsReconnection: z.boolean().optional(),
});
const accountsShape = z.looseObject({ accounts: z.array(accountShape) });
const healthShape = z.looseObject({
  accounts: z
    .array(z.looseObject({ accountId: z.string().min(1), status: z.string().nullish(), needsReconnect: z.boolean().optional(), tokenValid: z.boolean().nullish() }))
    .default([]),
});

const toProfile = (raw: z.infer<typeof profileShape>): ZernioProfile => ({ id: raw._id, name: raw.name, externalId: raw.externalId ?? null });

const toAccounts = (accounts: z.infer<typeof accountShape>[]): ZernioAccountInfo[] =>
  accounts.map((raw) => ({
    id: raw._id,
    platform: raw.platform,
    profileId: typeof raw.profileId === 'string' ? raw.profileId : (raw.profileId?._id ?? null),
    username: raw.username || null,
    displayName: raw.displayName || null,
    profileUrl: raw.profileUrl ?? null,
    isActive: raw.isActive ?? true,
    needsReconnection: raw.needsReconnection ?? false,
  }));

function parseBody(body: string): unknown {
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

// ----- Publicações: leitura tolerante (o texto de erro da rede, errorMessage, nunca é lido) -----
const targetShape = z.looseObject({
  platform: z.string().default(''),
  accountId: z.union([z.string(), z.looseObject({ _id: z.string(), username: text.nullish(), displayName: text.nullish() })]).nullish(),
  customContent: z.string().nullish(),
  status: z.string().nullish(),
  platformPostUrl: z.string().nullish(),
  publishedAt: z.string().nullish(),
  errorCategory: z.string().max(60).nullish(),
  platformSpecificData: z
    .looseObject({ contentType: z.string().max(40).nullish(), title: z.string().max(200).nullish(), link: z.string().max(600).nullish(), boardId: z.string().max(100).nullish() })
    .nullish(),
});
const postShape = z.looseObject({
  _id: z.string().min(1),
  status: z.string().default('draft'),
  content: z.string().nullish(),
  scheduledFor: z.string().nullish(),
  timezone: z.string().nullish(),
  mediaItems: z.array(z.looseObject({ url: z.string().nullish() })).nullish(),
  platforms: z.array(targetShape).nullish(),
  createdAt: z.string().nullish(),
  updatedAt: z.string().nullish(),
});
const onePostShape = z.looseObject({ post: postShape });
const maybePostShape = z.looseObject({ post: postShape.nullish() });
const postsListShape = z.looseObject({ posts: z.array(postShape), pagination: z.looseObject({ nextCursor: z.string().nullish() }).nullish() });
const presignShape = z.looseObject({ uploadUrl: z.string(), publicUrl: z.string() });
const metricNumber = z
  .unknown()
  .transform((value) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0));
const metricsShape = z.looseObject(Object.fromEntries(ZERNIO_METRICS.map((metric) => [metric, metricNumber])) as Record<(typeof ZERNIO_METRICS)[number], typeof metricNumber>);
const dailyMetricsShape = z.looseObject({
  dailyData: z.array(z.looseObject({ date: z.string(), postCount: metricNumber, metrics: metricsShape.nullish() })).nullish(),
  platformBreakdown: z.array(metricsShape.extend({ platform: z.string(), postCount: metricNumber })).nullish(),
  totals: metricsShape.extend({ postCount: metricNumber }).nullish(),
});
const postMetricsShape = z.looseObject({
  posts: z
    .array(
      z.looseObject({
        platform: z.string().nullish(),
        content: z.string().nullish(),
        publishedAt: z.string().nullish(),
        platformPostUrl: z.string().nullish(),
        analytics: metricsShape.nullish(),
      }),
    )
    .nullish(),
});
const boardsShape = z.looseObject({ boards: z.array(z.looseObject({ id: z.string().nullish(), _id: z.string().nullish(), name: z.string().nullish() })).nullish() });

const emptyMetrics = (): ZernioMetrics => ({ impressions: 0, reach: 0, likes: 0, comments: 0, shares: 0, saves: 0, clicks: 0, views: 0 });
const pickMetrics = (raw: Partial<ZernioMetrics> | null | undefined): ZernioMetrics => {
  const metrics = emptyMetrics();
  for (const metric of ZERNIO_METRICS) metrics[metric] = raw?.[metric] ?? 0;
  return metrics;
};

const toPost = (raw: z.infer<typeof postShape>): ZernioPost => ({
  id: raw._id,
  status: raw.status,
  content: raw.content ?? '',
  scheduledFor: raw.scheduledFor ?? null,
  timezone: raw.timezone ?? null,
  mediaUrls: (raw.mediaItems ?? []).map((item) => item.url ?? '').filter(Boolean),
  targets: (raw.platforms ?? []).map((target) => {
    const account = target.accountId;
    return {
      platform: target.platform,
      accountId: typeof account === 'string' ? account : (account?._id ?? ''),
      accountUsername: typeof account === 'object' && account ? (account.username ?? null) : null,
      accountDisplayName: typeof account === 'object' && account ? (account.displayName ?? null) : null,
      status: target.status ?? 'pending',
      platformPostUrl: target.platformPostUrl ?? null,
      publishedAt: target.publishedAt ?? null,
      errorCategory: target.errorCategory ?? null,
      contentType: target.platformSpecificData?.contentType ?? null,
      pinterest:
        target.platform === 'pinterest'
          ? { title: target.platformSpecificData?.title ?? null, link: target.platformSpecificData?.link ?? null, boardId: target.platformSpecificData?.boardId ?? null }
          : null,
      customContent: target.customContent ?? null,
    };
  }),
  createdAt: raw.createdAt ?? null,
  updatedAt: raw.updatedAt ?? null,
});

/** Segundos do Retry-After (só número; data HTTP vira null) */
function retryAfter(headers: HttpResponse['headers']): number | null {
  const value = headers?.['retry-after'];
  const first = Array.isArray(value) ? value[0] : value;
  if (!first || !/^\d{1,6}$/.test(first.trim())) return null;
  return Number(first.trim());
}

/** Erro da Zernio pelo status e por type/code (REFERENCIA_ZERNIO §3), nunca pelo texto */
export function classifyZernioError(status: number, body: unknown, headers?: HttpResponse['headers']): ZernioError {
  const record = body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const code = typeof record.code === 'string' ? record.code : null;
  const type = typeof record.type === 'string' ? record.type : null;
  const details = record.details !== null && typeof record.details === 'object' ? (record.details as Record<string, unknown>) : null;
  // Só códigos curtos conhecidos no formato (letras, números e _), para decidir a mensagem e ir para o log
  const reason = typeof record.reason === 'string' && /^[a-z0-9_]{1,60}$/i.test(record.reason) ? record.reason : null;
  const make = (kind: ZernioErrorKind) => new ZernioError(kind, status, code, details, reason, status === 429 ? retryAfter(headers) : null);
  if (status === 401 || type === 'authentication_error') return make('unauthorized');
  if (status === 402 || code === 'PAYMENT_REQUIRED') return make('payment_required');
  if (code === 'PLATFORM_BETA_RESTRICTED' || code === 'PLATFORM_DISABLED') return make('platform_unavailable');
  if (status === 403 || type === 'permission_error') return make('forbidden');
  if (status === 404) return make('not_found');
  if (status === 409) return make('conflict');
  if (status === 429) return make('rate_limited');
  if (status === 400 || status === 422) return make('invalid');
  return make('failed');
}

// ----- Automações de comentário (formato tolerante: a resposta completa não está na documentação) -----
const idRef = z.union([z.string(), z.looseObject({ _id: z.string().nullish(), id: z.string().nullish() })]).nullish();
const count = z.number().nullish();
const automationShape = z.looseObject({
  id: z.string().nullish(),
  _id: z.string().nullish(),
  name: z.string().nullish(),
  platform: z.string().nullish(),
  accountId: idRef,
  trigger: z.string().nullish(),
  keywords: z.array(z.string()).nullish(),
  matchMode: z.string().nullish(),
  platformPostId: z.string().nullish(),
  postTitle: z.string().nullish(),
  isActive: z.boolean().nullish(),
  repeatPolicy: z.looseObject({ mode: z.string().nullish(), cooldownHours: z.number().nullish() }).nullish(),
  audience: z.looseObject({ followerStatus: z.string().nullish() }).nullish(),
  followGate: z.looseObject({ message: z.string().nullish(), buttonLabel: z.string().nullish(), notFollowingMessage: z.string().nullish() }).nullish(),
  dmMessage: z.string().nullish(),
  buttons: z.array(z.looseObject({ type: z.string().nullish(), title: z.string().nullish(), url: z.string().nullish() })).nullish(),
  commentReply: z.string().nullish(),
  publicReplyPolicy: z.string().nullish(),
  alsoMatchInDms: z.boolean().nullish(),
  stats: z.looseObject({ triggered: count, dmsSent: count, dmsFailed: count, uniqueContacts: count, linkClicks: count, followGateSent: count, followGatePassed: count }).nullish(),
  createdAt: z.string().nullish(),
});
const automationsListShape = z.looseObject({ automations: z.array(automationShape) });
const automationDetailShape = z.looseObject({ automation: automationShape });
const automationUpdateShape = z.looseObject({ automation: automationShape.nullish() });

// Fluxos (A5): a lista não traz o grafo; só o que a tela precisa
const workflowShape = z.looseObject({
  id: z.string().nullish(),
  _id: z.string().nullish(),
  name: z.string().nullish(),
  description: z.string().nullish(),
  accountId: idRef,
  status: z.string().nullish(),
  nodeCount: count,
  totalStarted: count,
  totalCompleted: count,
});
const workflowsListShape = z.looseObject({ workflows: z.array(workflowShape) });
const workflowOneShape = z.looseObject({ workflow: workflowShape.nullish() });

// Registros (A4): só os campos que a tela usa; o texto do comentário é lido só para dono e administradores
const logShape = z.looseObject({
  id: z.string().nullish(),
  _id: z.string().nullish(),
  status: z.string().nullish(),
  source: z.string().nullish(),
  error: z.string().nullish(),
  clickCount: count,
  createdAt: z.string().nullish(),
  commentText: z.string().nullish(),
  commenterName: z.string().nullish(),
  commenterUsername: z.string().nullish(),
});
const missSampleShape = z.looseObject({
  commentText: z.string().nullish(),
  commenterName: z.string().nullish(),
  excludedBy: z.string().nullish(),
  at: z.string().nullish(),
});
const logsShape = z.looseObject({
  logs: z.array(logShape).nullish(),
  pagination: z.looseObject({ total: count }).nullish(),
  misses: z.looseObject({ total: count, samples: z.array(missSampleShape).nullish() }).nullish(),
});

const refId = (value: z.infer<typeof idRef>): string | null => (typeof value === 'string' ? value : (value?._id ?? value?.id ?? null)) || null;
const whole = (value: number | null | undefined) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);
const capped = (value: string | null | undefined, max: number) => (typeof value === 'string' ? value.slice(0, max) : null);
const httpsOnly = (value: string | null | undefined) => (typeof value === 'string' && /^https:\/\//i.test(value) ? value.slice(0, 500) : null);

function toAutomation(raw: z.infer<typeof automationShape>): ZernioCommentAutomation | null {
  const id = raw.id ?? raw._id ?? null;
  if (!id) return null;
  const everyComment = raw.repeatPolicy?.mode === 'every_comment';
  return {
    id,
    name: (raw.name ?? '').slice(0, 120),
    platform: raw.platform ?? null,
    accountId: refId(raw.accountId),
    trigger: raw.trigger ?? 'comment',
    keywords: (raw.keywords ?? []).slice(0, 50).map((keyword) => keyword.slice(0, 100)),
    matchMode: raw.matchMode ?? null,
    platformPostId: raw.platformPostId ?? null,
    postTitle: capped(raw.postTitle, 200),
    // A Zernio cria ativa quando isActive não vem; ausente na leitura conta como ativa (o lado seguro é avisar)
    isActive: raw.isActive !== false,
    repeatMode: everyComment ? 'every_comment' : 'once',
    cooldownHours: everyComment && typeof raw.repeatPolicy?.cooldownHours === 'number' ? Math.floor(raw.repeatPolicy.cooldownHours) : null,
    followersOnly: raw.audience?.followerStatus === 'follower',
    followGate:
      raw.audience?.followerStatus === 'follower' && raw.followGate?.message
        ? { message: raw.followGate.message.slice(0, 2000), buttonLabel: (raw.followGate.buttonLabel ?? '').slice(0, 40), notFollowingMessage: (raw.followGate.notFollowingMessage ?? '').slice(0, 2000) }
        : null,
    dmMessage: capped(raw.dmMessage, 2000),
    buttons: (raw.buttons ?? []).slice(0, 3).map((button) => ({ type: button.type ?? 'url', title: (button.title ?? '').slice(0, 40), url: httpsOnly(button.url) })),
    commentReply: capped(raw.commentReply, 2000),
    publicReplyPolicy: raw.publicReplyPolicy ?? null,
    alsoMatchInDms: raw.alsoMatchInDms === true,
    stats: {
      triggered: whole(raw.stats?.triggered),
      dmsSent: whole(raw.stats?.dmsSent),
      dmsFailed: whole(raw.stats?.dmsFailed),
      uniqueContacts: whole(raw.stats?.uniqueContacts),
      linkClicks: whole(raw.stats?.linkClicks),
      followGateSent: whole(raw.stats?.followGateSent),
      followGatePassed: whole(raw.stats?.followGatePassed),
    },
    createdAt: raw.createdAt ?? null,
  };
}

function parseWith<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ZernioError('failed');
  return parsed.data;
}

/**
 * Endereço de envio ou público devolvido pela Zernio: só https. A exceção é a própria origem configurada (a Zernio simulada
 * dos testes, em http://127.0.0.1); em produção a origem é https://zernio.com, então nada em http passa.
 */
function transferUrl(value: string, base: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ZernioError('failed');
  }
  if (url.username || url.password) throw new ZernioError('failed');
  if (url.protocol === 'https:' || url.origin === new URL(base).origin) return url;
  throw new ZernioError('failed');
}

const POST_LIST_FIELDS = 'content,mediaItems,platforms,scheduledFor,timezone,status,createdAt,updatedAt';

export interface ZernioClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
  /** Tempo-limite de publicar na hora, editar e tentar de novo (os testes usam um valor curto) */
  publishTimeoutMs?: number;
}

/** Fluxo da Zernio; sem id, descartado (nunca mostrado a uma empresa por engano) */
function toWorkflow(raw: z.infer<typeof workflowShape>): ZernioWorkflow | null {
  const id = raw.id ?? raw._id;
  if (!id) return null;
  return {
    id,
    name: raw.name ?? '',
    description: raw.description ?? null,
    accountId: refId(raw.accountId),
    status: raw.status ?? 'draft',
    nodeCount: whole(raw.nodeCount),
    totalStarted: whole(raw.totalStarted),
    totalCompleted: whole(raw.totalCompleted),
  };
}

export function createZernioClient(apiKey: string,{ baseUrl = ZERNIO_API_BASE, timeoutMs = TIMEOUT_MS, publishTimeoutMs = PUBLISH_TIMEOUT_MS }: ZernioClientOptions = {}): ZernioClient {
  const base = baseUrl.replace(/\/+$/, '');

  async function send(
    method: HttpMethod,
    path: string,
    query: Record<string, string | null> = {},
    body?: unknown,
    extra: { headers?: Record<string, string>; timeoutMs?: number } = {},
  ): Promise<{ status: number; data: unknown }> {
    const url = new URL(`${base}${path}`);
    for (const [name, value] of Object.entries(query)) if (value !== null) url.searchParams.set(name, value);
    let response: HttpResponse;
    try {
      response = await httpRequest(method, url, { ...extra.headers, authorization: `Bearer ${apiKey}` }, body, extra.timeoutMs ?? timeoutMs);
    } catch {
      // Sem a mensagem de rede: ela pode trazer endereço e detalhes internos
      throw new ZernioError('unreachable');
    }
    const parsed = parseBody(response.body);
    if (response.status >= 200 && response.status < 300) return { status: response.status, data: parsed };
    throw classifyZernioError(response.status, parsed, response.headers);
  }

  async function call(method: HttpMethod, path: string, query: Record<string, string | null> = {}, body?: unknown): Promise<unknown> {
    return (await send(method, path, query, body)).data;
  }

  const postPath = (postId: string) => `/posts/${encodeURIComponent(postId)}`;
  const publishResult = (result: { status: number; data: unknown }, method: 'POST' | 'PUT'): ZernioPublishResult => ({
    post: toPost(parseWith(onePostShape, result.data).post),
    partial: result.status === 207,
    replayed: method === 'POST' && result.status === 200,
  });

  return {
    async verify() {
      return { name: parseWith(verifyShape, await call('GET', '/auth/verify')).name ?? null };
    },
    async findProfileByExternalId(externalId) {
      const { profiles } = parseWith(profilesShape, await call('GET', '/profiles', { externalId }));
      const match = profiles.find((profile) => profile.externalId === externalId);
      return match ? toProfile(match) : null;
    },
    async getProfile(profileId) {
      try {
        return toProfile(parseWith(oneProfileShape, await call('GET', `/profiles/${encodeURIComponent(profileId)}`)).profile);
      } catch (err) {
        if (err instanceof ZernioError && err.kind === 'not_found') return null;
        throw err;
      }
    },
    async createProfile({ name, externalId, description }) {
      return toProfile(parseWith(oneProfileShape, await call('POST', '/profiles', {}, { name, externalId, description })).profile);
    },
    async connectUrl({ platform, profileId, redirectUrl, reconnectAccountId }) {
      const { authUrl } = parseWith(connectShape, await call('GET', `/connect/${encodeURIComponent(platform)}`, { profileId, redirect_url: redirectUrl, reconnectAccountId }));
      // O navegador será mandado para lá: só https
      let parsed: URL;
      try {
        parsed = new URL(authUrl);
      } catch {
        throw new ZernioError('failed');
      }
      if (parsed.protocol !== 'https:') throw new ZernioError('failed');
      return parsed.toString();
    },
    async listAccounts(profileId) {
      return toAccounts(parseWith(accountsShape, await call('GET', '/accounts', { profileId })).accounts);
    },
    async listTeamAccounts() {
      return toAccounts(parseWith(accountsShape, await call('GET', '/accounts', { status: 'connected' })).accounts);
    },
    async listProfiles() {
      return parseWith(profilesShape, await call('GET', '/profiles')).profiles.map(toProfile);
    },
    async listInboxConversations({ profileId, accountId, platform, cursor, limit }) {
      const payload = parseWith(inboxConversationsPageShape, await call('GET', '/inbox/conversations', { profileId, accountId, platform, cursor, limit: String(limit), sortOrder: 'desc' }));
      return {
        items: payload.data.map((item) => ({
          id: item.id,
          platform: item.platform ?? null,
          accountId: item.accountId ?? null,
          participantName: item.participantName ?? null,
          lastMessage: item.lastMessage ?? null,
          updatedTime: item.updatedTime ?? null,
          status: item.status ?? null,
          unreadCount: item.unreadCount ?? null,
        })),
        ...inboxPage(payload.pagination),
      };
    },
    async listInboxMessages({ conversationId, accountId, cursor, limit, sortOrder }) {
      const payload = parseWith(inboxMessagesPageShape, await call('GET', `/inbox/conversations/${encodeURIComponent(conversationId)}/messages`, { accountId, cursor, limit: String(limit), sortOrder }));
      return {
        items: payload.messages.map((item) => ({
          id: item.id,
          direction: item.direction,
          message: item.message ?? null,
          attachmentTypes: (item.attachments ?? []).map(attachmentType),
          createdAt: item.createdAt ?? null,
          sentAt: item.sentAt ?? null,
        })),
        ...inboxPage(payload.pagination),
        sortOrderApplied: payload.sortOrderApplied ?? null,
      };
    },
    async sendInboxMessage(conversationId, input, idempotencyKey) {
      const { data } = await send('POST', `/inbox/conversations/${encodeURIComponent(conversationId)}/messages`, {}, input, {
        headers: { 'idempotency-key': idempotencyKey },
        timeoutMs: publishTimeoutMs,
      });
      const parsed = sendReplyShape.safeParse(data);
      // Sem id da plataforma na resposta, não dá para afirmar que saiu: quem chama trata como desconhecido
      return { messageId: parsed.success ? (parsed.data.data?.messageId ?? null) : null };
    },
    async inboxProbe(profileId) {
      // Só a quantidade: o conteúdo das conversas nunca sai daqui
      const body = await call('GET', '/inbox/conversations', { profileId, limit: '1' });
      const parsed = inboxProbeShape.safeParse(body);
      // Só os nomes das chaves de topo (estrutura, sem valores), para o diagnóstico quando o formato não bater
      const keys = body !== null && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body).filter((key) => /^[a-zA-Z_]{1,40}$/.test(key)).slice(0, 12) : [];
      return { conversations: parsed.success ? parsed.data.data.length : null, keys };
    },
    async accountsHealth(profileId) {
      const { accounts } = parseWith(healthShape, await call('GET', '/accounts/health', { profileId }));
      return accounts.map((raw) => ({ accountId: raw.accountId, status: raw.status ?? null, needsReconnect: raw.needsReconnect ?? false, tokenValid: raw.tokenValid ?? null }));
    },
    async deleteAccount(accountId) {
      await call('DELETE', `/accounts/${encodeURIComponent(accountId)}`);
    },

    async uploadImage({ fileName, contentType, bytes }) {
      const presign = parseWith(presignShape, await call('POST', '/media/presign', {}, { filename: fileName, contentType, size: bytes.byteLength }));
      const uploadUrl = transferUrl(presign.uploadUrl, base);
      const publicUrl = transferUrl(presign.publicUrl, base);
      let response: HttpResponse;
      try {
        // Endereço assinado de um arquivo só: a chave da empresa NUNCA vai junto (é outro servidor, de armazenamento)
        response = await httpRequest('PUT', uploadUrl, { 'content-type': contentType }, bytes, UPLOAD_TIMEOUT_MS);
      } catch {
        throw new ZernioError('unreachable');
      }
      if (response.status < 200 || response.status >= 300) throw new ZernioError('failed', response.status);
      return publicUrl.toString();
    },
    async createPost(body, idempotencyKey) {
      return publishResult(await send('POST', '/posts', {}, body, { headers: { 'idempotency-key': idempotencyKey }, timeoutMs: publishTimeoutMs }), 'POST');
    },
    async getPost(postId) {
      return toPost(parseWith(onePostShape, await call('GET', postPath(postId))).post);
    },
    async updatePost(postId, body) {
      return publishResult(await send('PUT', postPath(postId), {}, body, { timeoutMs: publishTimeoutMs }), 'PUT');
    },
    async deletePost(postId) {
      await call('DELETE', postPath(postId));
    },
    async retryPost(postId) {
      const { data } = await send('POST', `${postPath(postId)}/retry`, {}, {}, { timeoutMs: publishTimeoutMs });
      const parsed = maybePostShape.safeParse(data);
      return parsed.success && parsed.data.post ? toPost(parsed.data.post) : null;
    },
    async reschedulePost(postId, { scheduledFor, timezone }) {
      return publishResult(await send('PUT', postPath(postId), {}, { scheduledFor, timezone }), 'PUT').post;
    },
    async unpublishPost(postId, { platform, accountId }) {
      await call('POST', `${postPath(postId)}/unpublish`, {}, { platform, accountId });
    },
    async listPosts({ profileId, updatedSince, cursor }) {
      const query = { profileId, updatedSince, limit: '100', fields: POST_LIST_FIELDS, cursor };
      const parsed = parseWith(postsListShape, await call('GET', '/posts', query));
      return { posts: parsed.posts.map(toPost), nextCursor: parsed.pagination?.nextCursor ?? null };
    },
    async dailyMetrics({ profileId, fromDate, toDate }) {
      const parsed = parseWith(dailyMetricsShape, await call('GET', '/analytics/daily-metrics', { profileId, fromDate, toDate }));
      return {
        postCount: parsed.totals?.postCount ?? 0,
        totals: pickMetrics(parsed.totals),
        byPlatform: (parsed.platformBreakdown ?? []).map((item) => ({ platform: item.platform, postCount: item.postCount, metrics: pickMetrics(item) })),
        daily: (parsed.dailyData ?? []).map((day) => ({ date: day.date, postCount: day.postCount, metrics: pickMetrics(day.metrics) })),
      };
    },
    async postMetrics({ profileId, fromDate, toDate, limit }) {
      const parsed = parseWith(postMetricsShape, await call('GET', '/analytics', { profileId, fromDate, toDate, sortBy: 'engagement', order: 'desc', limit: String(limit) }));
      return (parsed.posts ?? []).map((item) => ({
        platform: item.platform ?? '',
        content: item.content ?? '',
        publishedAt: item.publishedAt ?? null,
        platformPostUrl: item.platformPostUrl ?? null,
        metrics: pickMetrics(item.analytics),
      }));
    },
    async pinterestBoards(accountId) {
      const parsed = parseWith(boardsShape, await call('GET', `/accounts/${encodeURIComponent(accountId)}/pinterest-boards`));
      return (parsed.boards ?? [])
        .map((board) => ({ id: board.id ?? board._id ?? '', name: (board.name ?? '').slice(0, 120) }))
        .filter((board) => board.id);
    },
    async listCommentAutomations(profileId) {
      const parsed = parseWith(automationsListShape, await call('GET', '/comment-automations', { profileId }));
      return parsed.automations.map(toAutomation).filter((item): item is ZernioCommentAutomation => item !== null);
    },
    async getCommentAutomation(automationId) {
      const parsed = parseWith(automationDetailShape, await call('GET', `/comment-automations/${encodeURIComponent(automationId)}`));
      const automation = toAutomation(parsed.automation);
      if (!automation) throw new ZernioError('failed');
      return automation;
    },
    async createCommentAutomation(body) {
      const parsed = parseWith(automationDetailShape, await call('POST', '/comment-automations', {}, body));
      const automation = toAutomation(parsed.automation);
      if (!automation) throw new ZernioError('failed');
      return automation;
    },
    async updateCommentAutomation(automationId, body) {
      const parsed = parseWith(automationUpdateShape, await call('PATCH', `/comment-automations/${encodeURIComponent(automationId)}`, {}, body));
      return parsed.automation ? toAutomation(parsed.automation) : null;
    },
    async deleteCommentAutomation(automationId) {
      await call('DELETE', `/comment-automations/${encodeURIComponent(automationId)}`);
    },
    async listCommentAutomationLogs(automationId, { limit, skip }) {
      const parsed = parseWith(logsShape, await call('GET', `/comment-automations/${encodeURIComponent(automationId)}/logs`, { limit: String(limit), skip: String(skip) }));
      const logs = (parsed.logs ?? []).flatMap((raw) => {
        const id = raw.id ?? raw._id;
        if (!id) return [];
        return [
          {
            id,
            status: raw.status ?? 'unknown',
            source: raw.source ?? null,
            error: raw.error ?? null,
            clickCount: whole(raw.clickCount),
            createdAt: raw.createdAt ?? null,
            commentText: raw.commentText ?? null,
            commenterName: raw.commenterName ?? null,
            commenterUsername: raw.commenterUsername ?? null,
          },
        ];
      });
      const misses = parsed.misses
        ? {
            total: whole(parsed.misses.total),
            samples: (parsed.misses.samples ?? []).map((sample) => ({
              commentText: sample.commentText ?? null,
              commenterName: sample.commenterName ?? null,
              excludedBy: sample.excludedBy ?? null,
              at: sample.at ?? null,
            })),
          }
        : null;
      return { logs, total: whole(parsed.pagination?.total) || logs.length, misses };
    },
    async listWorkflows(profileId) {
      const parsed = parseWith(workflowsListShape, await call('GET', '/workflows', { profileId }));
      return parsed.workflows.map(toWorkflow).filter((item): item is ZernioWorkflow => item !== null);
    },
    async createWorkflow(body) {
      const parsed = parseWith(workflowOneShape, await call('POST', '/workflows', {}, body));
      const workflow = parsed.workflow ? toWorkflow(parsed.workflow) : null;
      if (!workflow) throw new ZernioError('failed');
      return workflow;
    },
    async setWorkflowActive(workflowId, active) {
      const path = `/workflows/${encodeURIComponent(workflowId)}/${active ? 'activate' : 'pause'}`;
      const parsed = parseWith(workflowOneShape, await call('POST', path));
      const workflow = parsed.workflow ? toWorkflow(parsed.workflow) : null;
      if (!workflow) throw new ZernioError('failed');
      return workflow;
    },
    async deleteWorkflow(workflowId) {
      await call('DELETE', `/workflows/${encodeURIComponent(workflowId)}`);
    },
  };
}
