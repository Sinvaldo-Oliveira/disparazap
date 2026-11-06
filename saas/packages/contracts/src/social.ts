import { z } from 'zod';
import { INTERNAL_API_PREFIX } from './auth.ts';
import { MEDIA_LIMITS, type ImageMimeType } from './messaging.ts';
import { LOCAL_DATETIME_RE, timeZoneSchema } from './timezone.ts';
import { ZERNIO_ACCOUNT_STATES } from './zernio.ts';

// Módulo Redes Sociais: publicar, agendar e acompanhar pela Zernio da empresa (saas/docs/PLANO_MODULO_REDES_SOCIAIS.md).
// A página Integrações conecta as contas; aqui ficam a operação diária e as regras de cada rede (seção B.2 do plano).

export const SOCIAL_PATH = `${INTERNAL_API_PREFIX}/social`;
export const SOCIAL_OVERVIEW_PATH = `${SOCIAL_PATH}/overview`;
export const SOCIAL_ACCOUNTS_PATH = `${SOCIAL_PATH}/accounts`;
export const socialPinterestBoardsPath = (accountId: string) => `${SOCIAL_ACCOUNTS_PATH}/${encodeURIComponent(accountId)}/pinterest-boards`;
export const SOCIAL_POSTS_PATH = `${SOCIAL_PATH}/posts`;
export const socialPostPath = (id: string) => `${SOCIAL_POSTS_PATH}/${encodeURIComponent(id)}`;
export const socialPostRetryPath = (id: string) => `${socialPostPath(id)}/retry`;
export const socialPostUnpublishPath = (id: string) => `${socialPostPath(id)}/unpublish`;
export const socialPostReschedulePath = (id: string) => `${socialPostPath(id)}/reschedule`;
export const SOCIAL_SETTINGS_PATH = `${SOCIAL_PATH}/settings`;
export const SOCIAL_MEDIA_PATH = `${SOCIAL_PATH}/media`;
export const socialMediaPath = (id: string) => `${SOCIAL_MEDIA_PATH}/${encodeURIComponent(id)}`;
export const SOCIAL_ANALYTICS_PATH = `${SOCIAL_PATH}/analytics`;

/** Rotas do painel (abas da seção) */
export const SOCIAL_ROUTES = {
  overview: '/redes-sociais',
  create: '/redes-sociais/criar',
  calendar: '/redes-sociais/calendario',
  library: '/redes-sociais/biblioteca',
  history: '/redes-sociais/historico',
  results: '/redes-sociais/resultados',
  interactions: '/redes-sociais/interacoes',
} as const;
export const socialEditRoute = (id: string) => `${SOCIAL_ROUTES.create}/${encodeURIComponent(id)}`;

// ----- Regras de cada rede (só imagem e texto nesta etapa; vídeo vem na etapa S6) -----

/** Redes em que já dá para publicar pelo DisparaZap (decisão R7). TikTok e YouTube exigem vídeo */
export const SOCIAL_PUBLISH_PLATFORMS = ['instagram', 'facebook', 'linkedin', 'threads', 'pinterest', 'googlebusiness', 'twitter'] as const;
export type SocialPublishPlatform = (typeof SOCIAL_PUBLISH_PLATFORMS)[number];
export const isPublishPlatform = (platform: string): platform is SocialPublishPlatform => (SOCIAL_PUBLISH_PLATFORMS as readonly string[]).includes(platform);

/** Por que uma rede conectada ainda não publica pelo painel */
export const SOCIAL_VIDEO_ONLY_NOTE = 'Esta rede publica só vídeo, que chega na próxima etapa do módulo.';

export const SOCIAL_FORMATS = ['post', 'story'] as const;
export type SocialFormat = (typeof SOCIAL_FORMATS)[number];
export const SOCIAL_FORMAT_LABELS: Readonly<Record<SocialFormat, string>> = { post: 'Publicação', story: 'Story' };

export interface SocialNetworkRule {
  /** Limite de caracteres do texto (no Pinterest, a descrição do pin) */
  maxChars: number;
  /** Aceita publicação só com texto */
  textOnly: boolean;
  minImages: number;
  maxImages: number;
  imageTypes: readonly ImageMimeType[];
  maxImageBytes: number;
  /** Aceita Story (1 imagem, sem texto) */
  story: boolean;
  /** Aviso curto mostrado ao escolher a rede */
  note: string;
}

const JPEG_PNG: readonly ImageMimeType[] = ['image/jpeg', 'image/png'];
const JPEG_PNG_WEBP: readonly ImageMimeType[] = ['image/jpeg', 'image/png', 'image/webp'];
const MB = 1024 * 1024;

/** Limites conferidos na documentação oficial da Zernio em 2026-11-03 (plano, seção B.2); 5 MB é o limite da biblioteca */
export const SOCIAL_RULES: Readonly<Record<SocialPublishPlatform, SocialNetworkRule>> = {
  instagram: { maxChars: 2200, textOnly: false, minImages: 1, maxImages: 10, imageTypes: JPEG_PNG, maxImageBytes: MEDIA_LIMITS.maxBytes, story: true, note: 'Só contas Business ou Creator. Toda publicação leva imagem (até 10, em carrossel); o Story não leva texto.' },
  facebook: { maxChars: 63206, textOnly: true, minImages: 0, maxImages: 10, imageTypes: JPEG_PNG_WEBP, maxImageBytes: 4 * MB, story: true, note: 'Só Páginas. Imagens de até 4 MB; o Story não leva texto.' },
  linkedin: { maxChars: 3000, textOnly: true, minImages: 0, maxImages: 20, imageTypes: JPEG_PNG, maxImageBytes: MEDIA_LIMITS.maxBytes, story: false, note: 'O LinkedIn recusa texto repetido, mesmo publicado semanas atrás.' },
  threads: { maxChars: 500, textOnly: true, minImages: 0, maxImages: 10, imageTypes: JPEG_PNG, maxImageBytes: MEDIA_LIMITS.maxBytes, story: false, note: 'Até 500 caracteres: use o texto personalizado se o geral for maior.' },
  pinterest: { maxChars: 800, textOnly: false, minImages: 1, maxImages: 1, imageTypes: JPEG_PNG_WEBP, maxImageBytes: MEDIA_LIMITS.maxBytes, story: false, note: 'Cada pin leva 1 imagem e vai para uma pasta. O texto vira a descrição do pin.' },
  googlebusiness: { maxChars: 1500, textOnly: true, minImages: 0, maxImages: 1, imageTypes: JPEG_PNG, maxImageBytes: MEDIA_LIMITS.maxBytes, story: false, note: 'Aparece no Google (Busca e Maps) por cerca de 7 dias. Imagem de pelo menos 400×300.' },
  twitter: { maxChars: 280, textOnly: true, minImages: 0, maxImages: 4, imageTypes: JPEG_PNG_WEBP, maxImageBytes: MEDIA_LIMITS.maxBytes, story: false, note: 'O X cobra por post na sua conta Zernio (US$ 0,015; US$ 0,20 com link) e exige cartão. Até 280 caracteres (links contam 23).' },
};

/** Caracteres como as redes contam (emojis e acentos inteiros, não em pedaços) */
export const countChars = (text: string) => [...text].length;

// ----- Entrada: criar ou alterar uma publicação -----

export const SOCIAL_LIMITS = {
  contentMax: 63206,
  targetsMax: 20,
  mediaMax: 20,
  pinterestTitleMax: 100,
  linkMax: 500,
  pageSize: 50,
  searchMax: 100,
} as const;

const httpsLink = z
  .string()
  .trim()
  .max(SOCIAL_LIMITS.linkMax)
  .regex(/^https:\/\/[^\s/$.?#][^\s]*$/i, 'Use um link completo que comece com https://');

export const socialTargetInputSchema = z.strictObject({
  accountId: z.string().trim().min(1).max(100),
  platform: z.enum(SOCIAL_PUBLISH_PLATFORMS),
  format: z.enum(SOCIAL_FORMATS).default('post'),
  /** Texto só desta rede (null = usa o texto geral) */
  customContent: z.string().max(SOCIAL_LIMITS.contentMax).nullable().default(null),
  /** Só no Pinterest: título, link de destino e pasta */
  pinterest: z
    .strictObject({
      title: z.string().trim().max(SOCIAL_LIMITS.pinterestTitleMax).default(''),
      link: httpsLink.nullable().default(null),
      boardId: z.string().trim().min(1).max(100).nullable().default(null),
    })
    .nullable()
    .default(null),
});
export type SocialTargetInput = z.input<typeof socialTargetInputSchema>;

/** Imagem da biblioteca da empresa, ou imagem que a publicação já tinha na Zernio (só ao editar) */
export const socialMediaRefSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('library'), id: z.string().min(1).max(100) }),
  z.strictObject({ kind: z.literal('existing'), url: z.string().max(2000) }),
]);
export type SocialMediaRef = z.infer<typeof socialMediaRefSchema>;

export const SOCIAL_MODES = ['now', 'schedule', 'draft'] as const;
export type SocialMode = (typeof SOCIAL_MODES)[number];

export const socialPostInputSchema = z
  .strictObject({
    /** Identificador do pedido, gerado pelo painel: repetir o pedido nunca publica duas vezes (Idempotency-Key na Zernio) */
    requestId: z.uuid('Pedido inválido. Recarregue a página.'),
    content: z.string().max(SOCIAL_LIMITS.contentMax, 'Texto longo demais.').default(''),
    targets: z.array(socialTargetInputSchema).max(SOCIAL_LIMITS.targetsMax, 'Escolha até 20 contas.'),
    media: z.array(socialMediaRefSchema).max(SOCIAL_LIMITS.mediaMax, 'Use até 20 imagens.').default([]),
    mode: z.enum(SOCIAL_MODES),
    /** "AAAA-MM-DDTHH:mm" no fuso da empresa (só no modo schedule) */
    scheduledAt: z.string().regex(LOCAL_DATETIME_RE, 'Informe data e hora.').nullable().default(null),
  })
  .superRefine((input, ctx) => {
    if (input.mode === 'schedule' && !input.scheduledAt) ctx.addIssue({ code: 'custom', path: ['scheduledAt'], message: 'Informe a data e a hora da publicação.' });
    if (input.mode !== 'draft' && input.targets.length === 0) ctx.addIssue({ code: 'custom', path: ['targets'], message: 'Escolha pelo menos uma conta.' });
    const ids = input.targets.map((target) => target.accountId);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: ['targets'], message: 'A mesma conta foi escolhida duas vezes.' });
  });
export type SocialPostInput = z.input<typeof socialPostInputSchema>;
export type SocialPostParsed = z.output<typeof socialPostInputSchema>;

/** O que se sabe de cada imagem para conferir as regras (null = imagem que já estava na publicação) */
export interface SocialMediaInfo {
  mimeType: string | null;
  size: number | null;
}

/**
 * Confere as regras de cada rede (plano, seção B.2). Usada pelo painel (avisos ao vivo) e de novo pela API.
 * Devolve as mensagens de problema, por rede, prontas para a tela.
 */
export function socialRuleIssues(
  input: Pick<SocialPostParsed, 'content' | 'targets' | 'mode'>,
  media: readonly SocialMediaInfo[],
  labelOf: (target: SocialPostParsed['targets'][number]) => string,
): string[] {
  const issues: string[] = [];
  for (const target of input.targets) {
    const rule = SOCIAL_RULES[target.platform];
    const label = labelOf(target);
    const text = (target.customContent ?? input.content).trim();
    if (target.format === 'story') {
      if (!rule.story) issues.push(`${label}: esta rede não tem Story.`);
      else if (media.length !== 1) issues.push(`${label}: o Story leva exatamente 1 imagem.`);
    } else {
      if (countChars(text) > rule.maxChars) issues.push(`${label}: o texto passa de ${rule.maxChars.toLocaleString('pt-BR')} caracteres (tem ${countChars(text).toLocaleString('pt-BR')}).`);
      if (media.length < rule.minImages) issues.push(rule.minImages === 1 ? `${label}: precisa de uma imagem.` : `${label}: precisa de pelo menos ${rule.minImages} imagens.`);
      if (media.length > rule.maxImages) issues.push(rule.maxImages === 1 ? `${label}: aceita só 1 imagem.` : `${label}: aceita até ${rule.maxImages} imagens.`);
      if (!media.length && !text && input.mode !== 'draft') issues.push(`${label}: escreva um texto ou escolha uma imagem.`);
    }
    for (const item of media) {
      if (item.mimeType && !(rule.imageTypes as readonly string[]).includes(item.mimeType)) {
        issues.push(`${label}: aceita só ${rule.imageTypes.map((type) => type.replace('image/', '').toUpperCase()).join(', ')}.`);
        break;
      }
      if (item.size !== null && item.size > rule.maxImageBytes) {
        issues.push(`${label}: cada imagem pode ter até ${Math.round(rule.maxImageBytes / MB)} MB.`);
        break;
      }
    }
  }
  return issues;
}

// ----- Saída -----

export const SOCIAL_POST_STATUSES = ['draft', 'pending_approval', 'scheduled', 'publishing', 'published', 'partial', 'failed', 'cancelled'] as const;
export type SocialPostStatus = (typeof SOCIAL_POST_STATUSES)[number];
export const SOCIAL_POST_STATUS_LABELS: Readonly<Record<SocialPostStatus, string>> = {
  draft: 'Rascunho',
  pending_approval: 'Aguardando aprovação',
  scheduled: 'Agendada',
  publishing: 'Publicando',
  published: 'Publicada',
  partial: 'Parcial',
  failed: 'Falhou',
  cancelled: 'Cancelada',
};
/** Pode editar ou reagendar (a Zernio também aceita partial, mas aí já há cópias publicadas: o painel não oferece) */
export const SOCIAL_EDITABLE: readonly SocialPostStatus[] = ['draft', 'scheduled', 'failed', 'cancelled', 'pending_approval'];
/** Pode cancelar ou excluir na Zernio (o que já está na rede continua lá) */
export const SOCIAL_DELETABLE: readonly SocialPostStatus[] = ['draft', 'pending_approval', 'scheduled', 'failed', 'partial', 'cancelled'];
/** A Zernio tenta de novo só as redes que falharam */
export const SOCIAL_RETRYABLE: readonly SocialPostStatus[] = ['failed', 'partial'];
/** Redes em que dá para remover um post já publicado (plano, B.3). Instagram e TikTok não permitem */
export const SOCIAL_UNPUBLISHABLE: readonly string[] = ['facebook', 'linkedin', 'threads', 'pinterest', 'googlebusiness', 'twitter', 'youtube'];

export const SOCIAL_TARGET_STATUSES = ['pending', 'processing', 'uploading', 'published', 'failed', 'cancelled'] as const;
export type SocialTargetStatus = (typeof SOCIAL_TARGET_STATUSES)[number];
export const SOCIAL_TARGET_STATUS_LABELS: Readonly<Record<SocialTargetStatus, string>> = {
  pending: 'Na fila',
  processing: 'Processando',
  uploading: 'Enviando',
  published: 'Publicada',
  failed: 'Falhou',
  cancelled: 'Removida',
};

/** O que fazer quando uma rede falha (categoria de erro da Zernio → ação) */
export const SOCIAL_ERROR_ACTIONS = ['reconnect', 'fix_content', 'fix_account', 'wait', 'retry'] as const;
export type SocialErrorAction = (typeof SOCIAL_ERROR_ACTIONS)[number];

/** Mensagens fixas por categoria (decisão R6): o texto original da rede nunca vai para a tela */
export const SOCIAL_ERROR_MESSAGES: Readonly<Record<string, { message: string; action: SocialErrorAction }>> = {
  auth_expired: { message: 'A rede pediu para reconectar a conta. Reconecte em Integrações e tente de novo.', action: 'reconnect' },
  user_content: { message: 'A rede recusou o conteúdo (formato, tamanho ou texto fora das regras dela). Ajuste e tente de novo.', action: 'fix_content' },
  user_abuse: { message: 'A rede limitou as publicações desta conta (excesso ou suspeita de spam). Aguarde antes de tentar de novo.', action: 'wait' },
  account_issue: { message: 'A conta não está pronta para publicar (tipo de conta ou configuração na própria rede).', action: 'fix_account' },
  platform_rejected: { message: 'A rede recusou o conteúdo pelas regras dela. Mude o conteúdo antes de tentar de novo.', action: 'fix_content' },
  platform_error: { message: 'A rede estava instável no momento. Tente de novo.', action: 'retry' },
  platform_rate_limit: { message: 'A rede pediu uma pausa. A Zernio tenta de novo sozinha.', action: 'wait' },
  quota_exhausted: { message: 'A cota diária da rede acabou. A publicação sai quando a cota renovar.', action: 'wait' },
  system_error: { message: 'Falha passageira na Zernio. Tente de novo.', action: 'retry' },
};
export const SOCIAL_ERROR_DEFAULT = { message: 'A rede não publicou. Tente de novo; se continuar, veja o motivo no painel da Zernio.', action: 'retry' as SocialErrorAction };

const httpsUrlOrNull = z.string().nullable();

export const socialTargetSchema = z.strictObject({
  platform: z.string(),
  accountId: z.string(),
  /** @usuario ou nome da conta, quando conhecido */
  accountLabel: z.string().nullable(),
  format: z.enum(SOCIAL_FORMATS),
  /** Texto próprio desta rede (null = o texto geral) */
  customContent: z.string().nullable(),
  status: z.enum(SOCIAL_TARGET_STATUSES),
  /** Endereço público do post na rede (só https) */
  url: httpsUrlOrNull,
  publishedAt: z.iso.datetime().nullable(),
  error: z.strictObject({ category: z.string(), message: z.string(), action: z.enum(SOCIAL_ERROR_ACTIONS) }).nullable(),
  /** Opções do pin (só Pinterest) */
  pinterest: z.strictObject({ title: z.string().nullable(), link: z.string().nullable(), boardId: z.string().nullable() }).nullable(),
});
export type SocialTarget = z.infer<typeof socialTargetSchema>;

export const socialPostMediaSchema = z.discriminatedUnion('kind', [
  /** Imagem da biblioteca (miniatura servida pela própria API) */
  z.strictObject({ kind: z.literal('library'), id: z.string(), url: z.string() }),
  /** Imagem que só existe na Zernio (ex.: publicação criada fora do DisparaZap) */
  z.strictObject({ kind: z.literal('existing'), url: z.string() }),
]);
export type SocialPostMedia = z.infer<typeof socialPostMediaSchema>;

export const socialPostSchema = z.strictObject({
  id: z.string(),
  status: z.enum(SOCIAL_POST_STATUSES),
  content: z.string(),
  scheduledFor: z.iso.datetime().nullable(),
  publishedAt: z.iso.datetime().nullable(),
  /** Quando aparece no calendário: agendamento, publicação ou última alteração (rascunho) */
  occursAt: z.iso.datetime(),
  timezone: z.string(),
  targets: z.array(socialTargetSchema),
  media: z.array(socialPostMediaSchema),
  /** Criada pelo painel do DisparaZap (false = criada direto na Zernio) */
  createdInApp: z.boolean(),
  createdByName: z.string().nullable(),
  updatedAt: z.iso.datetime(),
});
export type SocialPost = z.infer<typeof socialPostSchema>;

export const socialPostsResponseSchema = z.strictObject({
  posts: z.array(socialPostSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  timezone: z.string(),
  /** Última atualização com a Zernio (null = ainda não sincronizou) */
  syncedAt: z.iso.datetime().nullable(),
  /** A atualização com a Zernio falhou agora: a lista mostra o último estado conhecido */
  syncError: z.string().nullable(),
  canPublish: z.boolean(),
  canManage: z.boolean(),
});
export type SocialPostsResponse = z.infer<typeof socialPostsResponseSchema>;

export const socialPostsQuerySchema = z.strictObject({
  /** Intervalo (instantes ISO) para o calendário */
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  status: z.enum(SOCIAL_POST_STATUSES).optional(),
  platform: z.string().max(40).optional(),
  accountId: z.string().max(100).optional(),
  search: z.string().trim().max(SOCIAL_LIMITS.searchMax).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  /** Força a atualização com a Zernio (botão "Atualizar") */
  refresh: z.enum(['1']).optional(),
});
export type SocialPostsQuery = z.input<typeof socialPostsQuerySchema>;

/** Resultado de publicar, agendar ou salvar: a publicação e um resumo para a tela */
export const socialPostResultSchema = z.strictObject({
  post: socialPostSchema,
  /** O mesmo pedido já tinha sido feito: nada novo foi publicado */
  replayed: z.boolean(),
});
export type SocialPostResult = z.infer<typeof socialPostResultSchema>;

export const socialAccountSchema = z.strictObject({
  id: z.string(),
  platform: z.string(),
  username: z.string().nullable(),
  displayName: z.string().nullable(),
  state: z.enum(ZERNIO_ACCOUNT_STATES),
  /** Já dá para publicar nela pelo painel */
  publishable: z.boolean(),
  /** Por que não (ex.: rede só de vídeo; precisa reconectar) */
  reason: z.string().nullable(),
});
export type SocialAccount = z.infer<typeof socialAccountSchema>;

export const SOCIAL_CONNECTION_STATES = ['unavailable', 'not_configured', 'invalid', 'ok'] as const;
export type SocialConnectionState = (typeof SOCIAL_CONNECTION_STATES)[number];

export const socialAccountsResponseSchema = z.strictObject({
  connection: z.enum(SOCIAL_CONNECTION_STATES),
  accounts: z.array(socialAccountSchema),
  timezone: z.string(),
  canPublish: z.boolean(),
  canManage: z.boolean(),
});
export type SocialAccountsResponse = z.infer<typeof socialAccountsResponseSchema>;

export const SOCIAL_METRICS = ['impressions', 'reach', 'likes', 'comments', 'shares', 'saves', 'clicks', 'views'] as const;
export type SocialMetric = (typeof SOCIAL_METRICS)[number];
export const SOCIAL_METRIC_LABELS: Readonly<Record<SocialMetric, string>> = {
  impressions: 'Impressões',
  reach: 'Alcance',
  likes: 'Curtidas',
  comments: 'Comentários',
  shares: 'Compartilhamentos',
  saves: 'Salvamentos',
  clicks: 'Cliques',
  views: 'Visualizações',
};
/**
 * Métricas que cada rede informa (comparativo oficial da Zernio, plano seção B.3). Fora daqui, a tela mostra "—" (não
 * informado pela rede), nunca zero. O Google Business não tem métricas por post.
 */
export const SOCIAL_METRIC_SUPPORT: Readonly<Record<string, readonly SocialMetric[]>> = {
  twitter: ['impressions', 'likes', 'comments', 'shares', 'clicks', 'views'],
  instagram: ['impressions', 'reach', 'likes', 'comments', 'shares', 'saves', 'views'],
  facebook: ['impressions', 'likes', 'comments', 'shares', 'clicks', 'views'],
  linkedin: ['impressions', 'reach', 'likes', 'comments', 'shares', 'saves', 'clicks', 'views'],
  tiktok: ['likes', 'comments', 'shares', 'views'],
  youtube: ['likes', 'comments', 'shares', 'views'],
  pinterest: ['impressions', 'saves', 'clicks'],
  threads: ['impressions', 'likes', 'comments', 'shares', 'views'],
  googlebusiness: [],
};
export const metricSupported = (platform: string, metric: SocialMetric) => SOCIAL_METRIC_SUPPORT[platform]?.includes(metric) ?? true;

const metricsShape = z.strictObject(Object.fromEntries(SOCIAL_METRICS.map((metric) => [metric, z.number().nonnegative()])) as Record<SocialMetric, z.ZodNumber>);
export type SocialMetrics = z.infer<typeof metricsShape>;

export const SOCIAL_ANALYTICS_PERIODS = [7, 30, 90] as const;

export const socialAnalyticsSchema = z.discriminatedUnion('state', [
  z.strictObject({
    state: z.literal('available'),
    days: z.number().int(),
    from: z.string(),
    to: z.string(),
    postCount: z.number().int().nonnegative(),
    totals: metricsShape,
    byPlatform: z.array(z.strictObject({ platform: z.string(), postCount: z.number().int().nonnegative(), metrics: metricsShape })),
    daily: z.array(z.strictObject({ date: z.string(), postCount: z.number().int().nonnegative(), engagement: z.number().nonnegative(), impressions: z.number().nonnegative() })),
    topPosts: z.array(
      z.strictObject({
        platform: z.string(),
        content: z.string(),
        publishedAt: z.iso.datetime().nullable(),
        url: z.string().nullable(),
        metrics: metricsShape,
      }),
    ),
  }),
  z.strictObject({ state: z.literal('unavailable'), reason: z.enum(['plan', 'not_configured', 'syncing']), message: z.string() }),
]);
export type SocialAnalytics = z.infer<typeof socialAnalyticsSchema>;

export const socialAnalyticsQuerySchema = z.strictObject({
  days: z.coerce.number().refine((value) => (SOCIAL_ANALYTICS_PERIODS as readonly number[]).includes(value), 'Período inválido.').default(30),
});

export const socialAlertSchema = z.strictObject({
  kind: z.enum(['reconnect', 'warning', 'key_invalid', 'sync_failed', 'failed_posts']),
  message: z.string(),
});
export type SocialAlert = z.infer<typeof socialAlertSchema>;

export const socialOverviewSchema = z.strictObject({
  connection: z.enum(SOCIAL_CONNECTION_STATES),
  timezone: z.string(),
  canPublish: z.boolean(),
  canManage: z.boolean(),
  accounts: z.array(socialAccountSchema),
  counts: z.strictObject({
    published: z.number().int().nonnegative(),
    scheduled: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    drafts: z.number().int().nonnegative(),
  }),
  upcoming: z.array(socialPostSchema),
  alerts: z.array(socialAlertSchema),
  /** Resumo dos últimos 30 dias, quando a conta Zernio da empresa tem métricas */
  performance: socialAnalyticsSchema.nullable(),
  syncedAt: z.iso.datetime().nullable(),
});
export type SocialOverview = z.infer<typeof socialOverviewSchema>;

export const socialSettingsSchema = z.strictObject({ timezone: z.string(), canManage: z.boolean() });
export type SocialSettings = z.infer<typeof socialSettingsSchema>;
export const socialSettingsInputSchema = z.strictObject({ timezone: timeZoneSchema });

/** Reagendar: só a data e a hora, no fuso da empresa */
export const socialRescheduleInputSchema = z.strictObject({ scheduledAt: z.string().regex(LOCAL_DATETIME_RE, 'Informe data e hora.') });

export const socialUnpublishInputSchema = z.strictObject({
  platform: z.string().min(1).max(40),
  accountId: z.string().min(1).max(100),
});

export const pinterestBoardsSchema = z.strictObject({ boards: z.array(z.strictObject({ id: z.string(), name: z.string() })) });
export type PinterestBoards = z.infer<typeof pinterestBoardsSchema>;

/** Biblioteca de mídia da empresa (imagens; vídeo na etapa S6) */
export const socialLibraryItemSchema = z.strictObject({
  id: z.string(),
  mimeType: z.string(),
  size: z.number().int().positive(),
  fileName: z.string().nullable(),
  createdAt: z.iso.datetime(),
  /** Usada por um modelo de mensagem do WhatsApp (não pode ser excluída enquanto isso) */
  usedByTemplate: z.boolean(),
});
export type SocialLibraryItem = z.infer<typeof socialLibraryItemSchema>;
export const socialLibrarySchema = z.strictObject({
  items: z.array(socialLibraryItemSchema),
  limit: z.number().int().positive(),
  canUpload: z.boolean(),
  canDelete: z.boolean(),
});
export type SocialLibrary = z.infer<typeof socialLibrarySchema>;

/** Rótulo de uma conta para a tela */
export const socialAccountLabel = (account: { username: string | null; displayName: string | null }) =>
  account.username ? `@${account.username}` : (account.displayName ?? 'conta');

