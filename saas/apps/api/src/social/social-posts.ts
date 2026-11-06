import { and, asc, count, desc, eq, gte, ilike, inArray, lt, sql, type SQL } from 'drizzle-orm';
import {
  SOCIAL_DELETABLE,
  SOCIAL_EDITABLE,
  SOCIAL_LIMITS,
  SOCIAL_RETRYABLE,
  SOCIAL_UNPUBLISHABLE,
  ZERNIO_PLATFORM_LABELS,
  socialAccountLabel,
  socialPostInputSchema,
  socialPostsQuerySchema,
  socialRescheduleInputSchema,
  socialRuleIssues,
  socialUnpublishInputSchema,
  zonedLocalToDate,
  type SocialMediaInfo,
  type SocialPost,
  type SocialPostParsed,
  type SocialPostResult,
  type SocialPostStatus,
  type SocialPostsResponse,
  type ZernioAccount,
} from '@disparazap/contracts';
import { mediaFiles, socialPosts, type SocialPostMediaRow } from '@disparazap/db';
import { canManage, canOperate, type Member } from '../auth/member.ts';
import { ZernioError, type ZernioClient, type ZernioPost, type ZernioPostBody, type ZernioPublishResult } from '../integrations/zernio-client.ts';
import { readMedia } from '../messaging/media.ts';
import { ZernioServiceError, fromZernio, readAccounts, readyClient, type ConnectionRow, type ZernioContext } from '../zernio/zernio-service.ts';
import {
  deleteRow,
  loadRow,
  organizationTimezone,
  publicPosts,
  requirePublisher,
  requireSocialManager,
  upsertFromZernio,
  type SocialRow,
} from './social-common.ts';
import { trySync } from './social-sync.ts';

/**
 * Publicar, agendar, salvar rascunho, editar, cancelar, tentar de novo e remover da rede (PLANO_MODULO_REDES_SOCIAIS,
 * etapas S2 a S4). Sempre com a chave da empresa, só nas contas do perfil dela, conferindo as regras de cada rede.
 */

/** Extensão do arquivo enviado à Zernio, pelo tipo conferido nos bytes */
const EXTENSIONS: Readonly<Record<string, string>> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** Antecedência mínima de um agendamento (um horário já passado a Zernio publicaria na hora) */
const MIN_SCHEDULE_AHEAD_MS = 60_000;
const UNCERTAIN =
  'A Zernio não confirmou a tempo se a publicação foi feita. Confira o Histórico em instantes antes de tentar de novo (repetir o mesmo pedido não publica duas vezes).';

const parse = <T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false; error: { issues: { message: string }[] } } }, value: unknown): T => {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ZernioServiceError(400, parsed.error.issues[0]?.message ?? 'Dados inválidos.');
  return parsed.data;
};

const platformLabel = (platform: string) => (ZERNIO_PLATFORM_LABELS as Readonly<Record<string, string>>)[platform] ?? platform;

/** Erros da Zernio ao publicar ou alterar: mensagens fixas (nunca o texto da Zernio ou da rede) */
async function postError(ctx: ZernioContext, connection: ConnectionRow, err: unknown, action: 'create' | 'update'): Promise<never> {
  if (err instanceof ZernioServiceError) throw err;
  if (err instanceof ZernioError) {
    const diagnostic = { tipo: err.kind, status: err.httpStatus, codigo: err.code };
    if (err.kind === 'forbidden' && err.code === 'ACCOUNT_DISCONNECTED') {
      throw new ZernioServiceError(409, 'Uma das contas escolhidas está desconectada na Zernio. Reconecte em Integrações e tente de novo.', diagnostic);
    }
    if (err.kind === 'conflict') {
      throw new ZernioServiceError(
        409,
        action === 'create'
          ? 'A Zernio recusou: este mesmo conteúdo já foi publicado nesta conta nas últimas 24 horas. Mude o texto ou a imagem.'
          : 'A Zernio recusou a alteração (conflito com outra publicação, por exemplo o mesmo horário). Tente outro horário.',
        diagnostic,
      );
    }
    if (err.kind === 'invalid') {
      throw new ZernioServiceError(400, 'A Zernio recusou a publicação: confira o texto e as imagens de cada rede (o LinkedIn e o X também recusam texto repetido).', diagnostic);
    }
    if (err.kind === 'rate_limited') {
      const minutes = err.retryAfterSeconds ? Math.max(1, Math.ceil(err.retryAfterSeconds / 60)) : null;
      throw new ZernioServiceError(
        429,
        `Limite de publicações atingido (25 por hora em cada conta, além do limite diário de cada rede).${minutes ? ` Tente de novo em ${minutes} min.` : ' Tente de novo mais tarde.'}`,
        diagnostic,
      );
    }
  }
  return fromZernio(ctx, connection, err);
}

/** Erro "de passagem" (rede, 5xx): o pedido pode ter chegado. Só esses repetem com a mesma Idempotency-Key */
const transient = (err: unknown) => err instanceof ZernioError && (err.kind === 'unreachable' || (err.kind === 'failed' && (err.httpStatus === null || err.httpStatus >= 500)));

interface Prepared {
  timezone: string;
  scheduledFor: Date | null;
  connection: ConnectionRow;
  client: ZernioClient;
  accounts: Map<string, ZernioAccount>;
  /** Imagens na ordem do pedido: da biblioteca (com tipo e tamanho) ou já existentes na Zernio */
  media: ({ kind: 'library'; id: string; mimeType: string; size: number; fileName: string | null } | { kind: 'existing'; url: string })[];
}

async function prepare(ctx: ZernioContext, member: Member, input: SocialPostParsed, current: { mediaUrls: readonly string[] } | null): Promise<Prepared> {
  const timezone = await organizationTimezone(ctx.db, member.organizationId);
  let scheduledFor: Date | null = null;
  if (input.mode === 'schedule') {
    scheduledFor = zonedLocalToDate(input.scheduledAt ?? '', timezone);
    if (!scheduledFor) throw new ZernioServiceError(400, 'Data ou hora inválida.');
    if (scheduledFor.getTime() < (ctx.now?.() ?? Date.now()) + MIN_SCHEDULE_AHEAD_MS) throw new ZernioServiceError(400, 'Escolha um horário pelo menos 1 minuto no futuro.');
  }

  // Imagens: da biblioteca desta empresa, ou as que a publicação já tinha (só ao editar)
  const libraryIds = input.media.filter((item) => item.kind === 'library').map((item) => item.id);
  const rows = libraryIds.length
    ? await ctx.db
        .select({ id: mediaFiles.id, mimeType: mediaFiles.mimeType, size: mediaFiles.sizeBytes, fileName: mediaFiles.fileName })
        .from(mediaFiles)
        .where(and(eq(mediaFiles.organizationId, member.organizationId), inArray(mediaFiles.id, libraryIds)))
    : [];
  const byId = new Map(rows.map((row) => [row.id, row]));
  const media: Prepared['media'] = input.media.map((item) => {
    if (item.kind === 'library') {
      const row = byId.get(item.id);
      if (!row) throw new ZernioServiceError(404, 'Imagem não encontrada na biblioteca da empresa.');
      return { kind: 'library', ...row };
    }
    if (!current?.mediaUrls.includes(item.url)) throw new ZernioServiceError(400, 'Imagem inválida para esta publicação.');
    return { kind: 'existing', url: item.url };
  });

  const { row: connection, client } = await readyClient(ctx, member);
  let list: ZernioAccount[];
  try {
    list = await readAccounts(client, connection);
  } catch (err) {
    return fromZernio(ctx, connection, err);
  }
  const accounts = new Map(list.map((account) => [account.id, account]));
  for (const target of input.targets) {
    const account = accounts.get(target.accountId);
    if (!account) throw new ZernioServiceError(404, 'Conta não encontrada entre as redes conectadas da empresa. Atualize a página.');
    if (account.platform !== target.platform) throw new ZernioServiceError(400, 'A rede escolhida não corresponde à conta.');
    if (account.state === 'needs_reconnect') {
      throw new ZernioServiceError(409, `${platformLabel(account.platform)} ${socialAccountLabel(account)}: a conta precisa ser reconectada em Integrações.`);
    }
  }

  const infos: SocialMediaInfo[] = media.map((item) => (item.kind === 'library' ? { mimeType: item.mimeType, size: item.size } : { mimeType: null, size: null }));
  const issues = socialRuleIssues(input, infos, (target) => {
    const account = accounts.get(target.accountId);
    return `${platformLabel(target.platform)}${account ? ` ${socialAccountLabel(account)}` : ''}`;
  });
  if (issues.length) throw new ZernioServiceError(400, issues.join(' '));
  return { timezone, scheduledFor, connection, client, accounts, media };
}

/** Envia as imagens da biblioteca para o armazenamento da Zernio e monta o corpo do post (nomes exatos dos campos) */
async function buildBody(ctx: ZernioContext, member: Member, input: SocialPostParsed, prepared: Prepared, mode: 'create' | 'update'): Promise<{ body: ZernioPostBody; media: SocialPostMediaRow[] }> {
  const media: SocialPostMediaRow[] = [];
  for (const item of prepared.media) {
    if (item.kind === 'existing') {
      media.push({ url: item.url, mediaId: null });
      continue;
    }
    const { data } = await readMedia(ctx.db, member.organizationId, item.id);
    let url: string;
    try {
      url = await prepared.client.uploadImage({ fileName: `${item.id}.${EXTENSIONS[item.mimeType] ?? 'jpg'}`, contentType: item.mimeType, bytes: data });
    } catch (err) {
      return fromZernio(ctx, prepared.connection, err, { etapa: 'envio_de_imagem' });
    }
    media.push({ url, mediaId: item.id });
  }

  const platforms = input.targets.map((target) => {
    const specific: Record<string, unknown> = {};
    if (target.format === 'story') specific.contentType = 'story';
    if (target.platform === 'pinterest' && target.pinterest) {
      if (target.pinterest.title) specific.title = target.pinterest.title;
      if (target.pinterest.link) specific.link = target.pinterest.link;
      if (target.pinterest.boardId) specific.boardId = target.pinterest.boardId;
    }
    return {
      platform: target.platform,
      accountId: target.accountId,
      ...(target.customContent !== null && target.format === 'post' ? { customContent: target.customContent } : {}),
      ...(Object.keys(specific).length ? { platformSpecificData: specific } : {}),
    };
  });

  const timing: Pick<ZernioPostBody, 'publishNow' | 'scheduledFor' | 'isDraft'> =
    input.mode === 'now'
      ? { publishNow: true, ...(mode === 'update' ? { isDraft: false } : {}) }
      : input.mode === 'schedule'
        ? { scheduledFor: (prepared.scheduledFor as Date).toISOString(), ...(mode === 'update' ? { isDraft: false } : {}) }
        : { isDraft: true };
  return {
    body: { content: input.content, mediaItems: media.map((item) => ({ type: 'image', url: item.url })), platforms, timezone: prepared.timezone, ...timing },
    media,
  };
}

async function toResult(ctx: ZernioContext, row: SocialRow, replayed: boolean): Promise<SocialPostResult> {
  const [post] = await publicPosts(ctx.db, [row]);
  return { post: post as SocialPost, replayed };
}

/** Publicar agora, agendar ou salvar rascunho. O mesmo requestId nunca publica duas vezes */
export async function createSocialPost(ctx: ZernioContext, member: Member, raw: unknown): Promise<SocialPostResult> {
  requirePublisher(member);
  const input = parse(socialPostInputSchema, raw);
  const [existing] = await ctx.db
    .select()
    .from(socialPosts)
    .where(and(eq(socialPosts.organizationId, member.organizationId), eq(socialPosts.idempotencyKey, input.requestId)))
    .limit(1);
  if (existing) return toResult(ctx, existing, true);

  const prepared = await prepare(ctx, member, input, null);
  const { body, media } = await buildBody(ctx, member, input, prepared, 'create');
  let result: ZernioPublishResult;
  try {
    result = await prepared.client.createPost(body, input.requestId);
  } catch (err) {
    if (!transient(err)) return postError(ctx, prepared.connection, err, 'create');
    // O pedido pode ter chegado: repete UMA vez com a mesma chave (a Zernio devolve o post original, sem criar outro)
    try {
      result = await prepared.client.createPost(body, input.requestId);
    } catch (again) {
      if (transient(again)) throw new ZernioServiceError(502, UNCERTAIN, { tipo: 'incerto' });
      return postError(ctx, prepared.connection, again, 'create');
    }
  }
  const row = await upsertFromZernio(ctx.db, member.organizationId, result.post, prepared.timezone, {
    idempotencyKey: input.requestId,
    createdBy: member.userId,
    knownMedia: media,
  });
  return toResult(ctx, row, result.replayed);
}

/** Lê o post na Zernio; se ele sumiu lá (excluído no painel da Zernio), some daqui também */
async function freshPost(ctx: ZernioContext, member: Member, row: SocialRow, client: ZernioClient, connection: ConnectionRow): Promise<ZernioPost> {
  try {
    return await client.getPost(row.zernioPostId);
  } catch (err) {
    if (err instanceof ZernioError && err.kind === 'not_found') {
      await deleteRow(ctx.db, member.organizationId, row.id);
      throw new ZernioServiceError(404, 'Esta publicação não existe mais na Zernio (foi excluída por lá).');
    }
    return fromZernio(ctx, connection, err);
  }
}

const isStatus = (status: string, list: readonly SocialPostStatus[]) => (list as readonly string[]).includes(status);

/** Editar ou reagendar: só rascunho, agendada, com falha ou cancelada (situação conferida de novo na Zernio) */
export async function updateSocialPost(ctx: ZernioContext, member: Member, id: string, raw: unknown): Promise<SocialPostResult> {
  requirePublisher(member);
  const input = parse(socialPostInputSchema, raw);
  const row = await loadRow(ctx.db, member.organizationId, id);
  const notEditable = 'Esta publicação não pode mais ser alterada: ela já saiu ou está saindo.';
  if (!isStatus(row.status, SOCIAL_EDITABLE)) throw new ZernioServiceError(409, notEditable);
  const { row: connection, client } = await readyClient(ctx, member);
  const current = await freshPost(ctx, member, row, client, connection);
  if (!isStatus(current.status, SOCIAL_EDITABLE)) {
    await upsertFromZernio(ctx.db, member.organizationId, current, row.timezone);
    throw new ZernioServiceError(409, notEditable);
  }
  const prepared = await prepare(ctx, member, input, { mediaUrls: current.mediaUrls });
  const { body, media } = await buildBody(ctx, member, input, prepared, 'update');
  let result: ZernioPublishResult;
  try {
    result = await prepared.client.updatePost(row.zernioPostId, body);
  } catch (err) {
    if (err instanceof ZernioError && err.kind === 'not_found') {
      await deleteRow(ctx.db, member.organizationId, row.id);
      throw new ZernioServiceError(404, 'Esta publicação não existe mais na Zernio (foi excluída por lá).');
    }
    if (transient(err)) throw new ZernioServiceError(502, UNCERTAIN, { tipo: 'incerto' });
    return postError(ctx, prepared.connection, err, 'update');
  }
  const updated = await upsertFromZernio(ctx.db, member.organizationId, result.post, prepared.timezone, { knownMedia: [...row.media, ...media] });
  return toResult(ctx, updated, false);
}

/** Reagendar uma publicação agendada: só a data e a hora mudam na Zernio (redes, texto e opções ficam) */
export async function rescheduleSocialPost(ctx: ZernioContext, member: Member, id: string, raw: unknown): Promise<SocialPostResult> {
  requirePublisher(member);
  const { scheduledAt } = parse(socialRescheduleInputSchema, raw);
  const row = await loadRow(ctx.db, member.organizationId, id);
  if (row.status !== 'scheduled') throw new ZernioServiceError(409, 'Só publicações agendadas podem ser reagendadas.');
  const timezone = await organizationTimezone(ctx.db, member.organizationId);
  const when = zonedLocalToDate(scheduledAt, timezone);
  if (!when) throw new ZernioServiceError(400, 'Data ou hora inválida.');
  if (when.getTime() < (ctx.now?.() ?? Date.now()) + MIN_SCHEDULE_AHEAD_MS) throw new ZernioServiceError(400, 'Escolha um horário pelo menos 1 minuto no futuro.');
  const { row: connection, client } = await readyClient(ctx, member);
  let post: ZernioPost;
  try {
    post = await client.reschedulePost(row.zernioPostId, { scheduledFor: when.toISOString(), timezone });
  } catch (err) {
    if (err instanceof ZernioError && err.kind === 'not_found') {
      await deleteRow(ctx.db, member.organizationId, row.id);
      throw new ZernioServiceError(404, 'Esta publicação não existe mais na Zernio (foi excluída por lá).');
    }
    if (err instanceof ZernioError && err.kind === 'invalid') throw new ZernioServiceError(409, 'A Zernio não aceitou o novo horário: a publicação pode já ter saído. Atualize a página.');
    return postError(ctx, connection, err, 'update');
  }
  return toResult(ctx, await upsertFromZernio(ctx.db, member.organizationId, post, timezone), false);
}

/** Cancelar e excluir na Zernio (o que já está publicado numa rede continua lá) */
export async function deleteSocialPost(ctx: ZernioContext, member: Member, id: string): Promise<void> {
  requirePublisher(member);
  const row = await loadRow(ctx.db, member.organizationId, id);
  if (!isStatus(row.status, SOCIAL_DELETABLE)) {
    throw new ZernioServiceError(409, 'Publicação já publicada: para tirá-la de uma rede, use "Remover da rede" nos detalhes.');
  }
  const { row: connection, client } = await readyClient(ctx, member);
  try {
    await client.deletePost(row.zernioPostId);
  } catch (err) {
    if (!(err instanceof ZernioError && err.kind === 'not_found')) {
      if (err instanceof ZernioError && err.kind === 'invalid') throw new ZernioServiceError(409, 'A Zernio não deixou excluir: a publicação já saiu. Atualize a página.');
      return fromZernio(ctx, connection, err);
    }
  }
  await deleteRow(ctx.db, member.organizationId, row.id);
}

const retrying = new Set<string>();

/** Tentar de novo as redes que falharam. Pedidos repetidos enquanto um está em andamento são recusados */
export async function retrySocialPost(ctx: ZernioContext, member: Member, id: string): Promise<SocialPostResult> {
  requirePublisher(member);
  const row = await loadRow(ctx.db, member.organizationId, id);
  if (!isStatus(row.status, SOCIAL_RETRYABLE)) throw new ZernioServiceError(409, 'Só publicações com falha podem ser tentadas de novo.');
  if (retrying.has(row.id)) throw new ZernioServiceError(409, 'Já existe uma nova tentativa em andamento para esta publicação.');
  retrying.add(row.id);
  try {
    const { row: connection, client } = await readyClient(ctx, member);
    let post: ZernioPost | null;
    try {
      post = await client.retryPost(row.zernioPostId);
    } catch (err) {
      if (err instanceof ZernioError && err.kind === 'conflict') throw new ZernioServiceError(409, 'A Zernio ainda está publicando. Aguarde um pouco e atualize.');
      if (err instanceof ZernioError && err.kind === 'invalid') throw new ZernioServiceError(409, 'A Zernio informou que não há o que tentar de novo. Atualize a página.');
      if (transient(err)) throw new ZernioServiceError(502, UNCERTAIN, { tipo: 'incerto' });
      return fromZernio(ctx, connection, err);
    }
    const fresh = post ?? (await freshPost(ctx, member, row, client, connection));
    return toResult(ctx, await upsertFromZernio(ctx.db, member.organizationId, fresh, row.timezone), false);
  } finally {
    retrying.delete(row.id);
  }
}

/** Remover de uma rede um post já publicado (só onde a rede permite; irreversível) */
export async function unpublishSocialPost(ctx: ZernioContext, member: Member, id: string, raw: unknown): Promise<SocialPostResult> {
  requireSocialManager(member);
  const input = parse(socialUnpublishInputSchema, raw);
  const row = await loadRow(ctx.db, member.organizationId, id);
  const target = row.targets.find((item) => item.platform === input.platform && item.accountId === input.accountId);
  if (!target) throw new ZernioServiceError(404, 'Esta publicação não foi para essa conta.');
  if (!SOCIAL_UNPUBLISHABLE.includes(target.platform)) throw new ZernioServiceError(400, `${platformLabel(target.platform)} não permite remover publicações pela API. Remova direto na rede.`);
  if (target.status !== 'published') throw new ZernioServiceError(409, 'Nesta rede a publicação não está publicada.');
  const { row: connection, client } = await readyClient(ctx, member);
  try {
    await client.unpublishPost(row.zernioPostId, { platform: target.platform, accountId: target.accountId });
  } catch (err) {
    if (err instanceof ZernioError && err.kind === 'invalid') throw new ZernioServiceError(409, 'A Zernio não conseguiu remover nesta rede. Atualize a página e confira na rede.');
    return fromZernio(ctx, connection, err);
  }
  const fresh = await freshPost(ctx, member, row, client, connection);
  return toResult(ctx, await upsertFromZernio(ctx.db, member.organizationId, fresh, row.timezone), false);
}

/** Detalhes: relê o post na Zernio (se ela não responder, mostra o último estado conhecido) */
export async function getSocialPost(ctx: ZernioContext, member: Member, id: string): Promise<SocialPost> {
  let row = await loadRow(ctx.db, member.organizationId, id);
  try {
    const { row: connection, client } = await readyClient(ctx, member);
    row = await upsertFromZernio(ctx.db, member.organizationId, await freshPost(ctx, member, row, client, connection), row.timezone);
  } catch (err) {
    // Sem a Zernio agora (não configurada, chave recusada, fora do ar): mostra o último estado conhecido. Excluída lá: 404
    if (!(err instanceof ZernioServiceError) || err.status === 404) throw err;
  }
  const [post] = await publicPosts(ctx.db, [row]);
  return post as SocialPost;
}

/** Curingas do LIKE tratados como texto */
const escapeLike = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);

/** Lista para o calendário (com intervalo) ou para o histórico (paginada), depois de atualizar com a Zernio */
export async function listSocialPosts(ctx: ZernioContext, member: Member, rawQuery: unknown): Promise<SocialPostsResponse> {
  const query = parse(socialPostsQuerySchema, rawQuery);
  const timezone = await organizationTimezone(ctx.db, member.organizationId);
  const sync = await trySync(ctx, member, () => readyClient(ctx, member), timezone, query.refresh === '1');

  const filters: SQL[] = [eq(socialPosts.organizationId, member.organizationId)];
  if (query.status) filters.push(eq(socialPosts.status, query.status));
  if (query.platform) filters.push(sql`${socialPosts.targets} @> ${JSON.stringify([{ platform: query.platform }])}::jsonb`);
  if (query.accountId) filters.push(sql`${socialPosts.targets} @> ${JSON.stringify([{ accountId: query.accountId }])}::jsonb`);
  if (query.search) filters.push(ilike(socialPosts.content, `%${escapeLike(query.search)}%`));
  if (query.from) filters.push(gte(socialPosts.occursAt, new Date(query.from)));
  if (query.to) filters.push(lt(socialPosts.occursAt, new Date(query.to)));
  const where = and(...filters);

  const calendar = Boolean(query.from && query.to);
  const pageSize = calendar ? 500 : SOCIAL_LIMITS.pageSize;
  const page = calendar ? 1 : query.page;
  const [rows, [total]] = await Promise.all([
    ctx.db
      .select()
      .from(socialPosts)
      .where(where)
      .orderBy(calendar ? asc(socialPosts.occursAt) : desc(socialPosts.occursAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    ctx.db.select({ total: count() }).from(socialPosts).where(where),
  ]);
  return {
    posts: await publicPosts(ctx.db, rows),
    total: total?.total ?? 0,
    page,
    pageSize,
    timezone,
    syncedAt: sync.syncedAt?.toISOString() ?? null,
    syncError: sync.error,
    canPublish: canOperate(member),
    canManage: canManage(member),
  };
}

