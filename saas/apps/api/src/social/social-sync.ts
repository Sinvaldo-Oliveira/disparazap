import { eq } from 'drizzle-orm';
import { zernioConnections } from '@disparazap/db';
import type { Member } from '../auth/member.ts';
import { ZernioError, type ZernioClient } from '../integrations/zernio-client.ts';
import { ZernioServiceError, type ConnectionRow, type ZernioContext } from '../zernio/zernio-service.ts';
import { upsertFromZernio } from './social-common.ts';

/**
 * Sincronização incremental com a Zernio (PLANO_MODULO_REDES_SOCIAIS §E.3): ao abrir Visão Geral, Calendário ou
 * Histórico, a API pede só os posts do perfil da empresa que mudaram desde a última vez (GET /v1/posts?updatedSince).
 * Webhooks entram depois da publicação com HTTPS (etapa S8).
 */

/** Intervalo mínimo entre sincronizações da mesma empresa (o limite da Zernio é de 60 pedidos/min com até 2 redes) */
const SYNC_INTERVAL_MS = 30_000;
/** Mesmo com "Atualizar", no máximo uma a cada 5 s */
const FORCED_INTERVAL_MS = 5_000;
/** Primeira sincronização: o que mudou nos últimos 90 dias */
const FIRST_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
/** Folga contra relógios diferentes entre o DisparaZap e a Zernio */
const CLOCK_SKEW_MS = 60_000;
const MAX_PAGES = 10;

export interface SyncResult {
  syncedAt: Date | null;
  /** Mensagem para a tela quando a Zernio não respondeu: a lista mostra o último estado conhecido */
  error: string | null;
}

const lastRun = new Map<string, number>();
const inFlight = new Map<string, Promise<SyncResult>>();

/** Esquece as marcas de tempo (testes) */
export function resetSyncThrottle() {
  lastRun.clear();
}

async function run(ctx: ZernioContext, member: Member, row: ConnectionRow, client: ZernioClient, timezone: string): Promise<SyncResult> {
  const started = new Date(ctx.now?.() ?? Date.now());
  const since = row.postsSyncedAt ? new Date(row.postsSyncedAt.getTime() - CLOCK_SKEW_MS) : new Date(started.getTime() - FIRST_WINDOW_MS);
  let cursor: string | null = null;
  let pages = 0;
  try {
    do {
      const page = await client.listPosts({ profileId: row.profileId, updatedSince: since.toISOString(), cursor });
      for (const post of page.posts) await upsertFromZernio(ctx.db, member.organizationId, post, timezone);
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor && pages < MAX_PAGES);
  } catch (err) {
    if (!(err instanceof ZernioError)) throw err;
    const message =
      err.kind === 'unauthorized'
        ? 'A Zernio recusou a chave guardada. Cadastre uma chave nova em Integrações.'
        : err.kind === 'rate_limited'
          ? 'A Zernio pediu uma pausa. Os dados mostrados podem estar alguns minutos atrasados.'
          : 'Não foi possível atualizar com a Zernio agora. Os dados mostrados são os da última atualização.';
    return { syncedAt: row.postsSyncedAt, error: message };
  }
  await ctx.db.update(zernioConnections).set({ postsSyncedAt: started }).where(eq(zernioConnections.organizationId, member.organizationId));
  return { syncedAt: started, error: null };
}

/** Atualiza o espelho da empresa, respeitando o intervalo mínimo; pedidos simultâneos esperam a mesma sincronização */
export async function syncSocialPosts(
  ctx: ZernioContext,
  member: Member,
  ready: { row: ConnectionRow; client: ZernioClient },
  timezone: string,
  { force = false }: { force?: boolean } = {},
): Promise<SyncResult> {
  const key = member.organizationId;
  const running = inFlight.get(key);
  if (running) return running;
  const now = ctx.now?.() ?? Date.now();
  const last = lastRun.get(key) ?? 0;
  if (now - last < (force ? FORCED_INTERVAL_MS : SYNC_INTERVAL_MS)) return { syncedAt: ready.row.postsSyncedAt, error: null };
  lastRun.set(key, now);
  const promise = run(ctx, member, ready.row, ready.client, timezone).finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

/** Sincroniza quando a integração está pronta; sem Zernio configurada, só devolve a mensagem para a tela */
export async function trySync(
  ctx: ZernioContext,
  member: Member,
  readyFn: () => Promise<{ row: ConnectionRow; client: ZernioClient }>,
  timezone: string,
  force: boolean,
): Promise<SyncResult> {
  try {
    return await syncSocialPosts(ctx, member, await readyFn(), timezone, { force });
  } catch (err) {
    if (err instanceof ZernioServiceError) return { syncedAt: null, error: err.message };
    throw err;
  }
}
