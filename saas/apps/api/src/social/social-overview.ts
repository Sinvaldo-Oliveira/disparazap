import { and, asc, count, eq, gte, inArray } from 'drizzle-orm';
import {
  SOCIAL_VIDEO_ONLY_NOTE,
  ZERNIO_PLATFORM_LABELS,
  isPublishPlatform,
  socialAccountLabel,
  socialSettingsInputSchema,
  zonedDateKey,
  type PinterestBoards,
  type SocialAccount,
  type SocialAccountsResponse,
  type SocialAlert,
  type SocialAnalytics,
  type SocialConnectionState,
  type SocialMetrics,
  type SocialOverview,
  type SocialSettings,
  type ZernioAccount,
} from '@disparazap/contracts';
import { organizations, socialPosts } from '@disparazap/db';
import { canManage, canOperate, type Member } from '../auth/member.ts';
import { ZernioError, type ZernioMetrics } from '../integrations/zernio-client.ts';
import { ZernioServiceError, fromZernio, loadConnection, readAccounts, readyClient, type ZernioContext } from '../zernio/zernio-service.ts';
import { organizationTimezone, publicPosts, requireSocialManager, safeHttpsUrl } from './social-common.ts';
import { trySync } from './social-sync.ts';

/** Visão Geral, contas para publicar, fuso da empresa, métricas e pastas do Pinterest (PLANO_MODULO_REDES_SOCIAIS S1 e S7) */

const platformLabel = (platform: string) => (ZERNIO_PLATFORM_LABELS as Readonly<Record<string, string>>)[platform] ?? platform;

function toSocialAccount(account: ZernioAccount): SocialAccount {
  const publishPlatform = isPublishPlatform(account.platform);
  const reconnect = account.state === 'needs_reconnect';
  return {
    id: account.id,
    platform: account.platform,
    username: account.username,
    displayName: account.displayName,
    state: account.state,
    publishable: publishPlatform && !reconnect,
    reason: reconnect ? 'Precisa ser reconectada em Integrações.' : publishPlatform ? null : SOCIAL_VIDEO_ONLY_NOTE,
  };
}

/** Situação da integração e as contas do perfil da empresa (sem lançar erro: a tela mostra o motivo) */
async function connectionAndAccounts(ctx: ZernioContext, member: Member): Promise<{ connection: SocialConnectionState; accounts: SocialAccount[]; alert: SocialAlert | null }> {
  if (!ctx.vault) return { connection: 'unavailable', accounts: [], alert: null };
  const row = await loadConnection(ctx, member);
  if (!row) return { connection: 'not_configured', accounts: [], alert: null };
  try {
    const { row: ready, client } = await readyClient(ctx, member);
    try {
      return { connection: 'ok', accounts: (await readAccounts(client, ready)).map(toSocialAccount), alert: null };
    } catch (err) {
      return await fromZernio(ctx, ready, err);
    }
  } catch (err) {
    if (!(err instanceof ZernioServiceError)) throw err;
    const invalid = err.status === 409 && /chave/i.test(err.message);
    return { connection: invalid ? 'invalid' : 'ok', accounts: [], alert: { kind: invalid ? 'key_invalid' : 'sync_failed', message: err.message } };
  }
}

export async function socialAccounts(ctx: ZernioContext, member: Member): Promise<SocialAccountsResponse> {
  const [{ connection, accounts }, timezone] = await Promise.all([connectionAndAccounts(ctx, member), organizationTimezone(ctx.db, member.organizationId)]);
  return { connection, accounts, timezone, canPublish: canOperate(member), canManage: canManage(member) };
}

// ----- Métricas (cache curto por empresa: a Zernio limita a 6 pedidos/s nas métricas) -----

const ANALYTICS_TTL_MS = 5 * 60_000;
const analyticsCache = new Map<string, { at: number; value: SocialAnalytics }>();

export function resetAnalyticsCache() {
  analyticsCache.clear();
}

const DAY_MS = 24 * 60 * 60 * 1000;
const toMetrics = (metrics: ZernioMetrics): SocialMetrics => ({ ...metrics });

export async function socialAnalytics(ctx: ZernioContext, member: Member, days: number): Promise<SocialAnalytics> {
  const row = ctx.vault ? await loadConnection(ctx, member) : null;
  if (!row) return { state: 'unavailable', reason: 'not_configured', message: 'Configure a Zernio em Integrações para ver os resultados.' };
  const key = `${member.organizationId}:${days}`;
  const now = ctx.now?.() ?? Date.now();
  const cached = analyticsCache.get(key);
  if (cached && now - cached.at < ANALYTICS_TTL_MS) return cached.value;

  const { row: ready, client } = await readyClient(ctx, member);
  const timezone = await organizationTimezone(ctx.db, member.organizationId);
  const to = zonedDateKey(new Date(now), timezone);
  const from = zonedDateKey(new Date(now - (days - 1) * DAY_MS), timezone);
  let value: SocialAnalytics;
  try {
    const [daily, top] = await Promise.all([client.dailyMetrics({ profileId: ready.profileId, fromDate: from, toDate: to }), client.postMetrics({ profileId: ready.profileId, fromDate: from, toDate: to, limit: 10 })]);
    value = {
      state: 'available',
      days,
      from,
      to,
      postCount: daily.postCount,
      totals: toMetrics(daily.totals),
      byPlatform: daily.byPlatform.map((item) => ({ platform: item.platform.slice(0, 40), postCount: item.postCount, metrics: toMetrics(item.metrics) })),
      daily: daily.daily.map((day) => ({
        date: day.date.slice(0, 10),
        postCount: day.postCount,
        engagement: day.metrics.likes + day.metrics.comments + day.metrics.shares + day.metrics.saves,
        impressions: day.metrics.impressions,
      })),
      topPosts: top.map((post) => ({
        platform: post.platform.slice(0, 40),
        content: post.content.slice(0, 280),
        publishedAt: post.publishedAt && !Number.isNaN(Date.parse(post.publishedAt)) ? new Date(post.publishedAt).toISOString() : null,
        url: safeHttpsUrl(post.platformPostUrl),
        metrics: toMetrics(post.metrics),
      })),
    };
  } catch (err) {
    if (err instanceof ZernioError && err.kind === 'payment_required') {
      value = {
        state: 'unavailable',
        reason: 'plan',
        message: 'A sua conta Zernio não inclui as métricas (planos antigos pedem o complemento de Analytics). Veja a cobrança no painel da Zernio.',
      };
    } else return fromZernio(ctx, ready, err);
  }
  analyticsCache.set(key, { at: now, value });
  return value;
}

// ----- Visão Geral -----

const THIRTY_DAYS_MS = 30 * DAY_MS;

export async function socialOverview(ctx: ZernioContext, member: Member): Promise<SocialOverview> {
  const timezone = await organizationTimezone(ctx.db, member.organizationId);
  const { connection, accounts, alert } = await connectionAndAccounts(ctx, member);
  const sync = connection === 'ok' ? await trySync(ctx, member, () => readyClient(ctx, member), timezone, false) : { syncedAt: null, error: null };

  const org = eq(socialPosts.organizationId, member.organizationId);
  const now = new Date(ctx.now?.() ?? Date.now());
  const [byStatus, upcomingRows, [recentFailures]] = await Promise.all([
    ctx.db.select({ status: socialPosts.status, total: count() }).from(socialPosts).where(org).groupBy(socialPosts.status),
    ctx.db
      .select()
      .from(socialPosts)
      .where(and(org, eq(socialPosts.status, 'scheduled'), gte(socialPosts.occursAt, now)))
      .orderBy(asc(socialPosts.occursAt))
      .limit(5),
    ctx.db
      .select({ total: count() })
      .from(socialPosts)
      .where(and(org, inArray(socialPosts.status, ['failed', 'partial']), gte(socialPosts.occursAt, new Date(now.getTime() - THIRTY_DAYS_MS)))),
  ]);
  const totalOf = (...statuses: string[]) => byStatus.filter((item) => statuses.includes(item.status)).reduce((sum, item) => sum + item.total, 0);

  const alerts: SocialAlert[] = [];
  if (alert) alerts.push(alert);
  for (const account of accounts) {
    const label = `${platformLabel(account.platform)} ${socialAccountLabel(account)}`;
    if (account.state === 'needs_reconnect') alerts.push({ kind: 'reconnect', message: `${label}: a autorização venceu. Reconecte em Integrações para voltar a publicar.` });
    else if (account.state === 'warning') alerts.push({ kind: 'warning', message: `${label}: a Zernio aponta um problema na conta. Confira em Integrações.` });
  }
  if (sync.error) alerts.push({ kind: 'sync_failed', message: sync.error });
  const failures = recentFailures?.total ?? 0;
  if (failures) alerts.push({ kind: 'failed_posts', message: failures === 1 ? '1 publicação com falha nos últimos 30 dias. Veja no Histórico.' : `${failures} publicações com falha nos últimos 30 dias. Veja no Histórico.` });

  let performance: SocialAnalytics | null = null;
  if (connection === 'ok') {
    try {
      performance = await socialAnalytics(ctx, member, 30);
    } catch (err) {
      if (!(err instanceof ZernioServiceError)) throw err;
    }
  }

  return {
    connection,
    timezone,
    canPublish: canOperate(member),
    canManage: canManage(member),
    accounts,
    counts: { published: totalOf('published'), scheduled: totalOf('scheduled'), failed: totalOf('failed', 'partial'), drafts: totalOf('draft') },
    upcoming: await publicPosts(ctx.db, upcomingRows),
    alerts,
    performance,
    syncedAt: sync.syncedAt?.toISOString() ?? null,
  };
}

// ----- Fuso horário da empresa (decisão R3) -----

export async function getSocialSettings(ctx: ZernioContext, member: Member): Promise<SocialSettings> {
  return { timezone: await organizationTimezone(ctx.db, member.organizationId), canManage: canManage(member) };
}

export async function saveSocialSettings(ctx: ZernioContext, member: Member, raw: unknown): Promise<SocialSettings> {
  requireSocialManager(member);
  const parsed = socialSettingsInputSchema.safeParse(raw);
  if (!parsed.success) throw new ZernioServiceError(400, parsed.error.issues[0]?.message ?? 'Fuso horário inválido.');
  await ctx.db.update(organizations).set({ timezone: parsed.data.timezone }).where(eq(organizations.id, member.organizationId));
  resetAnalyticsCache();
  return getSocialSettings(ctx, member);
}

// ----- Pastas do Pinterest -----

export async function pinterestBoards(ctx: ZernioContext, member: Member, accountId: string): Promise<PinterestBoards> {
  const { row, client } = await readyClient(ctx, member);
  try {
    const account = (await readAccounts(client, row)).find((item) => item.id === accountId);
    if (!account) throw new ZernioServiceError(404, 'Conta não encontrada entre as redes conectadas da empresa.');
    if (account.platform !== 'pinterest') throw new ZernioServiceError(400, 'Esta conta não é do Pinterest.');
    return { boards: await client.pinterestBoards(accountId) };
  } catch (err) {
    if (err instanceof ZernioServiceError) throw err;
    return fromZernio(ctx, row, err);
  }
}
