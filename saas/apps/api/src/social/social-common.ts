import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import {
  DEFAULT_TIMEZONE,
  SOCIAL_ERROR_DEFAULT,
  SOCIAL_ERROR_MESSAGES,
  SOCIAL_POST_STATUSES,
  SOCIAL_TARGET_STATUSES,
  isValidTimeZone,
  mediaPath,
  socialPostSchema,
  type SocialPost,
  type SocialPostStatus,
  type SocialTargetStatus,
} from '@disparazap/contracts';
import { organizations, socialPosts, users, type AppDatabase, type SocialPostMediaRow, type SocialPostTargetRow } from '@disparazap/db';
import { canManage, canOperate, type Member } from '../auth/member.ts';
import type { ZernioPost } from '../integrations/zernio-client.ts';
import { ZernioServiceError } from '../zernio/zernio-service.ts';

/**
 * Peças comuns do módulo Redes Sociais (PLANO_MODULO_REDES_SOCIAIS §E): o espelho local das publicações da Zernio,
 * a tradução para o formato público e o fuso horário da empresa.
 */
export type SocialRow = typeof socialPosts.$inferSelect;
export type SocialRowValues = Omit<typeof socialPosts.$inferInsert, 'id' | 'organizationId' | 'createdAt'>;

export const PUBLISHERS_ONLY = 'Só o dono, os administradores e os operadores da empresa publicam e agendam.';
export const MANAGERS_ONLY = 'Só o dono e os administradores da empresa fazem isso.';
export const POST_NOT_FOUND = 'Publicação não encontrada.';

export function requirePublisher(member: Member) {
  if (!canOperate(member)) throw new ZernioServiceError(403, PUBLISHERS_ONLY);
}

export function requireSocialManager(member: Member) {
  if (!canManage(member)) throw new ZernioServiceError(403, MANAGERS_ONLY);
}

export async function organizationTimezone(db: AppDatabase, organizationId: string): Promise<string> {
  const [row] = await db.select({ timezone: organizations.timezone }).from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  return row && isValidTimeZone(row.timezone) ? row.timezone : DEFAULT_TIMEZONE;
}

const isPostStatus = (value: string): value is SocialPostStatus => (SOCIAL_POST_STATUSES as readonly string[]).includes(value);
const toTargetStatus = (value: string): SocialTargetStatus => ((SOCIAL_TARGET_STATUSES as readonly string[]).includes(value) ? (value as SocialTargetStatus) : 'pending');

/** Só https (link mostrado na tela e aberto pela pessoa) */
export function safeHttpsUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

function validDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time);
}

const shortText = (value: string | null | undefined, max: number) => (value ? value.slice(0, max) : null);

/**
 * Valores do espelho a partir do post da Zernio. Mantém o que a Zernio não devolve: o rótulo da conta e o id das imagens
 * da biblioteca (casadas pelo endereço público).
 */
export function rowValuesFromZernio(post: ZernioPost, previous: Pick<SocialRow, 'targets' | 'media' | 'timezone'> | null, fallbackTimezone: string, now: Date): SocialRowValues {
  const targets: SocialPostTargetRow[] = post.targets.map((target) => {
    const before = previous?.targets.find((item) => item.accountId === target.accountId && item.platform === target.platform);
    const label = target.accountUsername ? `@${target.accountUsername}` : (target.accountDisplayName ?? before?.accountLabel ?? null);
    return {
      platform: target.platform.slice(0, 40),
      accountId: target.accountId.slice(0, 100),
      accountLabel: shortText(label, 120),
      format: target.contentType === 'story' ? 'story' : 'post',
      customContent: target.customContent,
      status: toTargetStatus(target.status),
      url: safeHttpsUrl(target.platformPostUrl),
      publishedAt: validDate(target.publishedAt)?.toISOString() ?? null,
      errorCategory: target.errorCategory && /^[a-z_]{1,60}$/.test(target.errorCategory) ? target.errorCategory : target.status === 'failed' ? 'unknown' : null,
      pinterest: target.pinterest
        ? { title: shortText(target.pinterest.title, 100), link: safeHttpsUrl(target.pinterest.link), boardId: shortText(target.pinterest.boardId, 100) }
        : (before?.pinterest ?? null),
    };
  });
  const media: SocialPostMediaRow[] = post.mediaUrls.map((url) => ({ url: url.slice(0, 2000), mediaId: previous?.media.find((item) => item.url === url)?.mediaId ?? null }));
  const publishedTimes = targets.map((target) => (target.publishedAt ? Date.parse(target.publishedAt) : 0)).filter((time) => time > 0);
  const publishedAt = publishedTimes.length ? new Date(Math.max(...publishedTimes)) : null;
  const scheduledFor = validDate(post.scheduledFor);
  const updatedAt = validDate(post.updatedAt);
  const status = isPostStatus(post.status) ? post.status : 'publishing';
  const timezone = post.timezone && isValidTimeZone(post.timezone) ? post.timezone : (previous?.timezone ?? fallbackTimezone);
  return {
    zernioPostId: post.id,
    status,
    content: post.content,
    scheduledFor,
    publishedAt,
    occursAt: publishedAt ?? scheduledFor ?? updatedAt ?? validDate(post.createdAt) ?? now,
    timezone,
    targets,
    media,
    zernioUpdatedAt: updatedAt,
    updatedAt: now,
  };
}

/** Formato público (contrato): mensagens de erro fixas por categoria, nunca o texto da rede */
export function toPublicPost(row: SocialRow, creatorName: string | null): SocialPost {
  return socialPostSchema.parse({
    id: row.id,
    status: isPostStatus(row.status) ? row.status : 'publishing',
    content: row.content,
    scheduledFor: row.scheduledFor?.toISOString() ?? null,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    occursAt: row.occursAt.toISOString(),
    timezone: row.timezone,
    targets: row.targets.map((target) => {
      const status = toTargetStatus(target.status);
      const known = target.errorCategory ? SOCIAL_ERROR_MESSAGES[target.errorCategory] : undefined;
      return {
        platform: target.platform,
        accountId: target.accountId,
        accountLabel: target.accountLabel,
        format: target.format,
        customContent: target.customContent,
        status,
        url: target.url,
        publishedAt: target.publishedAt,
        error: status === 'failed' ? { category: target.errorCategory ?? 'unknown', ...(known ?? SOCIAL_ERROR_DEFAULT) } : null,
        pinterest: target.pinterest ?? null,
      };
    }),
    media: row.media.map((item) => (item.mediaId ? { kind: 'library', id: item.mediaId, url: mediaPath(item.mediaId) } : { kind: 'existing', url: item.url })),
    createdInApp: row.createdInApp,
    createdByName: creatorName,
    updatedAt: row.updatedAt.toISOString(),
  });
}

/** Nomes de quem criou cada publicação pelo painel */
export async function creatorNames(db: AppDatabase, rows: readonly SocialRow[]): Promise<Map<string, string>> {
  const ids = [...new Set(rows.map((row) => row.createdBy).filter((id): id is string => Boolean(id)))];
  if (!ids.length) return new Map();
  const found = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids));
  return new Map(found.map((user) => [user.id, user.name]));
}

export async function publicPosts(db: AppDatabase, rows: readonly SocialRow[]): Promise<SocialPost[]> {
  const names = await creatorNames(db, rows);
  return rows.map((row) => toPublicPost(row, row.createdBy ? (names.get(row.createdBy) ?? null) : null));
}

export async function loadRow(db: AppDatabase, organizationId: string, id: string): Promise<SocialRow> {
  if (!id || id.length > 100) throw new ZernioServiceError(404, POST_NOT_FOUND);
  const [row] = await db.select().from(socialPosts).where(and(eq(socialPosts.organizationId, organizationId), eq(socialPosts.id, id))).limit(1);
  if (!row) throw new ZernioServiceError(404, POST_NOT_FOUND);
  return row;
}

/** Grava (ou atualiza) o espelho de um post da Zernio; quem criou e a chave de idempotência só são gravados na criação */
export async function upsertFromZernio(
  db: AppDatabase,
  organizationId: string,
  post: ZernioPost,
  fallbackTimezone: string,
  extra: { id?: string; idempotencyKey?: string; createdBy?: string; knownMedia?: readonly SocialPostMediaRow[] } = {},
): Promise<SocialRow> {
  const now = new Date();
  const [previous] = await db.select().from(socialPosts).where(and(eq(socialPosts.organizationId, organizationId), eq(socialPosts.zernioPostId, post.id))).limit(1);
  const base = previous ?? (extra.knownMedia ? { targets: [], media: [...extra.knownMedia], timezone: fallbackTimezone } : null);
  const values = rowValuesFromZernio(post, base, fallbackTimezone, now);
  const creation = extra.createdBy ? { createdInApp: true, createdBy: extra.createdBy, idempotencyKey: extra.idempotencyKey ?? null } : {};
  const [row] = await db
    .insert(socialPosts)
    .values({ id: previous?.id ?? extra.id ?? randomUUID(), organizationId, ...values, ...creation })
    .onConflictDoUpdate({ target: [socialPosts.organizationId, socialPosts.zernioPostId], set: { ...values, ...creation } })
    .returning();
  if (!row) throw new Error('publicação não gravada');
  return row;
}

export async function deleteRow(db: AppDatabase, organizationId: string, id: string) {
  await db.delete(socialPosts).where(and(eq(socialPosts.organizationId, organizationId), eq(socialPosts.id, id)));
}
