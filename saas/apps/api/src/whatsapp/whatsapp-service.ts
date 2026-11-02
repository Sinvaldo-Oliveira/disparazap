import { randomBytes, randomUUID } from 'node:crypto';
import { and, asc, count, eq, isNull } from 'drizzle-orm';
import {
  validatePhone,
  whatsappInstanceSchema,
  type IntegrationState,
  type WhatsAppInstance,
} from '@disparazap/contracts';
import { integrationCredentials, organizations, whatsappInstances, type AppDatabase } from '@disparazap/db';
import { ProviderError, type ServerInstance, type WhatsAppProvider } from '../integrations/whatsapp-provider.ts';
import { resolveEvolutionIntegration } from '../platform/evolution-settings.ts';
import { lastFour, type Vault } from '../security/vault.ts';
import { canManage, type Member } from '../auth/member.ts';

export { canManage, type Member };

/** Falha com status HTTP e mensagem fixa para a tela */
export class WhatsAppError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'WhatsAppError';
    this.status = status;
  }
}

export type ProviderFactory = (input: { baseUrl: string; globalKey: string }) => WhatsAppProvider;

export interface WhatsAppContext {
  db: AppDatabase;
  vault: Vault | null;
  providerFactory: ProviderFactory;
}

const PROVIDER = 'evolution_go';
const TOKEN_KIND = 'instance_token';
/** O token só abre como token desta instância (dado autenticado do AES-GCM) */
const tokenContext = (instanceId: string) => `${PROVIDER}:${TOKEN_KIND}:${instanceId}`;

const UNAVAILABLE = 'A integração com o WhatsApp não está disponível. Fale com o administrador da plataforma.';
const NOT_FOUND = 'Instância não encontrada.';
const FORBIDDEN = 'Só o dono e os administradores da empresa podem fazer isso.';

export type InstanceRow = typeof whatsappInstances.$inferSelect;

export function toPublic(row: InstanceRow): WhatsAppInstance {
  return whatsappInstanceSchema.parse({
    id: row.id,
    displayName: row.displayName,
    status: row.status,
    phone: row.phoneE164,
    createdAt: row.createdAt.toISOString(),
    connectedAt: row.connectedAt?.toISOString() ?? null,
  });
}

/** dz_<8 primeiros caracteres da empresa>_<10 hexadecimais>: sem colisão entre empresas nem com instâncias de fora */
export function instanceName(organizationId: string): string {
  const org = organizationId.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'empresa';
  return `dz_${org}_${randomBytes(5).toString('hex')}`;
}

function requireManager(member: Member): void {
  if (!canManage(member)) throw new WhatsAppError(403, FORBIDDEN);
}

function providerFailure(err: unknown): never {
  if (err instanceof ProviderError) throw new WhatsAppError(err.kind === 'not_found' ? 404 : 502, err.message);
  throw err;
}

async function integrationState(ctx: WhatsAppContext): Promise<IntegrationState> {
  return (await resolveEvolutionIntegration(ctx.db, ctx.vault)).state;
}

export async function readyProvider(ctx: WhatsAppContext) {
  const integration = await resolveEvolutionIntegration(ctx.db, ctx.vault);
  if (integration.state !== 'ready' || !ctx.vault) throw new WhatsAppError(409, UNAVAILABLE);
  return { integration, vault: ctx.vault, provider: ctx.providerFactory({ baseUrl: integration.baseUrl, globalKey: integration.globalKey }) };
}

export async function loadInstance(ctx: WhatsAppContext, member: Member, id: string): Promise<InstanceRow> {
  const [row] = await ctx.db
    .select()
    .from(whatsappInstances)
    .where(and(eq(whatsappInstances.id, id), eq(whatsappInstances.organizationId, member.organizationId), isNull(whatsappInstances.deletedAt)))
    .limit(1);
  // Instância de outra empresa responde igual a inexistente
  if (!row) throw new WhatsAppError(404, NOT_FOUND);
  return row;
}

export async function openToken(ctx: WhatsAppContext, vault: Vault, row: InstanceRow): Promise<string> {
  if (!row.credentialId) throw new WhatsAppError(409, 'Esta instância não tem credencial. Exclua e crie de novo.');
  const [credential] = await ctx.db.select().from(integrationCredentials).where(eq(integrationCredentials.id, row.credentialId)).limit(1);
  if (!credential || credential.revokedAt) throw new WhatsAppError(409, 'Esta instância não tem credencial. Exclua e crie de novo.');
  return vault.open(credential, tokenContext(row.id));
}

async function updateRow(ctx: WhatsAppContext, row: InstanceRow, changes: Partial<InstanceRow>): Promise<InstanceRow> {
  const [updated] = await ctx.db
    .update(whatsappInstances)
    .set({ ...changes, updatedAt: new Date() })
    .where(eq(whatsappInstances.id, row.id))
    .returning();
  return updated ?? row;
}

/**
 * Grava o status visto na Evolution, só se algo mudou.
 * `duringConnection`: o painel está acompanhando uma conexão (QR ou código), então "ainda não conectado" continua "conectando".
 * Fora disso (abrir a lista), quem não está conectado no servidor aparece como desconectado; "created" (nunca conectada) fica igual.
 */
async function applyStatus(ctx: WhatsAppContext, row: InstanceRow, connected: boolean, phone: string | null, duringConnection: boolean): Promise<InstanceRow> {
  const now = new Date();
  let changes: Partial<InstanceRow> = {};
  if (connected) changes = { status: 'connected', phoneE164: phone ?? row.phoneE164, connectedAt: row.connectedAt ?? now };
  else if (row.status === 'created' || (duringConnection && row.status === 'connecting')) changes = {};
  else changes = { status: 'disconnected', phoneE164: null, connectedAt: null };

  const changed = (Object.keys(changes) as (keyof InstanceRow)[]).some((key) => {
    const before = row[key];
    const after = changes[key];
    return before instanceof Date && after instanceof Date ? before.getTime() !== after.getTime() : before !== after;
  });
  if (changed || duringConnection) return updateRow(ctx, row, { ...changes, lastStatusAt: now });
  return row;
}

/** Status atual pelo token da instância; o número (que o /instance/status não traz) vem do /instance/info */
async function pollStatus(ctx: WhatsAppContext, provider: WhatsAppProvider, row: InstanceRow, token: string): Promise<InstanceRow> {
  const { connected } = await provider.getStatus(token);
  let phone: string | null = null;
  if (connected && !row.phoneE164 && row.providerInstanceId) {
    phone = await provider
      .getInstance(row.providerInstanceId)
      .then((found) => found?.phone ?? null)
      .catch(() => null);
  }
  return applyStatus(ctx, row, connected, phone, true);
}

/**
 * Atualiza as linhas com o que o servidor informa agora (GET /instance/all, uma chamada só).
 * Sem integração ou com a Evolution fora do ar, mostra o último status conhecido: a lista nunca falha por isso.
 */
async function syncWithServer(ctx: WhatsAppContext, rows: InstanceRow[]): Promise<InstanceRow[]> {
  if (!rows.some((row) => row.providerInstanceId)) return rows;
  let server: Map<string, ServerInstance>;
  try {
    const { provider } = await readyProvider(ctx);
    server = new Map((await provider.listServerInstances()).map((item) => [item.id, item]));
  } catch {
    return rows;
  }
  return Promise.all(
    rows.map((row) => {
      const found = row.providerInstanceId ? server.get(row.providerInstanceId) : undefined;
      return found ? applyStatus(ctx, row, found.connected, found.phone, false) : row;
    }),
  );
}

export async function listInstances(ctx: WhatsAppContext, member: Member) {
  const rows = await ctx.db
    .select()
    .from(whatsappInstances)
    .where(and(eq(whatsappInstances.organizationId, member.organizationId), isNull(whatsappInstances.deletedAt)))
    .orderBy(asc(whatsappInstances.createdAt));
  const [org] = await ctx.db.select({ limit: organizations.maxWhatsappInstances }).from(organizations).where(eq(organizations.id, member.organizationId));
  return {
    instances: (await syncWithServer(ctx, rows)).map(toPublic),
    limit: org?.limit ?? 0,
    canManage: canManage(member),
    integration: await integrationState(ctx),
  };
}

export async function createInstance(ctx: WhatsAppContext, member: Member, displayName: string): Promise<WhatsAppInstance> {
  requireManager(member);
  const { integration, vault, provider } = await readyProvider(ctx);

  const [org] = await ctx.db.select({ limit: organizations.maxWhatsappInstances }).from(organizations).where(eq(organizations.id, member.organizationId));
  const [used] = await ctx.db
    .select({ total: count() })
    .from(whatsappInstances)
    .where(and(eq(whatsappInstances.organizationId, member.organizationId), isNull(whatsappInstances.deletedAt)));
  const limit = org?.limit ?? 0;
  if ((used?.total ?? 0) >= limit) {
    throw new WhatsAppError(409, `Limite de instâncias atingido: sua empresa pode ter ${limit} ${limit === 1 ? 'instância' : 'instâncias'}.`);
  }

  const id = randomUUID();
  const name = instanceName(member.organizationId);
  const token = randomBytes(32).toString('base64url');

  let providerInstanceId: string | null;
  try {
    ({ providerInstanceId } = await provider.createInstance({ name, token }));
  } catch (err) {
    providerFailure(err);
  }

  try {
    return await ctx.db.transaction(async (tx) => {
      const credentialId = randomUUID();
      await tx.insert(integrationCredentials).values({
        id: credentialId,
        organizationId: member.organizationId,
        provider: PROVIDER,
        kind: TOKEN_KIND,
        ...vault.seal(token, tokenContext(id)),
        last4: lastFour(token),
        createdBy: member.userId,
      });
      const [row] = await tx
        .insert(whatsappInstances)
        .values({
          id,
          organizationId: member.organizationId,
          providerServerId: integration.serverId,
          providerInstanceName: name,
          providerInstanceId,
          displayName: displayName.trim(),
          status: 'created',
          credentialId,
          createdBy: member.userId,
        })
        .returning();
      if (!row) throw new Error('instância não gravada');
      return toPublic(row);
    });
  } catch (err) {
    // Não deixa instância órfã na Evolution Go se o banco falhar
    const orphanId = providerInstanceId ?? (await provider.findInstanceId(name).catch(() => null));
    if (orphanId) await provider.deleteInstance(orphanId).catch(() => {});
    throw err;
  }
}

/** Inicia a conexão e devolve o QR Code */
export async function connectInstance(ctx: WhatsAppContext, member: Member, id: string) {
  requireManager(member);
  const { vault, provider } = await readyProvider(ctx);
  let row = await loadInstance(ctx, member, id);
  const token = await openToken(ctx, vault, row);
  try {
    await provider.startConnection(token);
    const qrCode = await provider.getQrCode(token);
    row = await updateRow(ctx, row, { status: 'connecting', lastStatusAt: new Date() });
    return { instance: toPublic(row), qrCode };
  } catch (err) {
    providerFailure(err);
  }
}

/** QR Code atual (só enquanto aguarda conexão); se já conectou, devolve o status sem QR */
export async function currentQrCode(ctx: WhatsAppContext, member: Member, id: string) {
  requireManager(member);
  const { vault, provider } = await readyProvider(ctx);
  let row = await loadInstance(ctx, member, id);
  const token = await openToken(ctx, vault, row);
  try {
    row = await pollStatus(ctx, provider, row, token);
    if (row.status === 'connected') return { instance: toPublic(row), qrCode: null };
    return { instance: toPublic(row), qrCode: await provider.getQrCode(token) };
  } catch (err) {
    providerFailure(err);
  }
}

export async function pairInstance(ctx: WhatsAppContext, member: Member, id: string, phoneInput: string) {
  requireManager(member);
  const phone = validatePhone(phoneInput);
  if (!phone.ok) throw new WhatsAppError(400, phone.error);
  const { vault, provider } = await readyProvider(ctx);
  let row = await loadInstance(ctx, member, id);
  const token = await openToken(ctx, vault, row);
  try {
    if (row.status !== 'connecting') await provider.startConnection(token);
    const code = await provider.pairWithPhone(token, phone.number);
    row = await updateRow(ctx, row, { status: 'connecting', lastStatusAt: new Date() });
    return { instance: toPublic(row), code };
  } catch (err) {
    providerFailure(err);
  }
}

export async function refreshStatus(ctx: WhatsAppContext, member: Member, id: string): Promise<WhatsAppInstance> {
  const { vault, provider } = await readyProvider(ctx);
  const row = await loadInstance(ctx, member, id);
  const token = await openToken(ctx, vault, row);
  try {
    return toPublic(await pollStatus(ctx, provider, row, token));
  } catch (err) {
    providerFailure(err);
  }
}

/** Um envio informou que o WhatsApp caiu: a lista passa a mostrar "Desconectado" */
export async function markDisconnected(ctx: WhatsAppContext, row: InstanceRow): Promise<void> {
  if (row.status !== 'disconnected') await updateRow(ctx, row, { status: 'disconnected', phoneE164: null, connectedAt: null, lastStatusAt: new Date() });
}

export async function logoutInstance(ctx: WhatsAppContext, member: Member, id: string): Promise<WhatsAppInstance> {
  requireManager(member);
  const { vault, provider } = await readyProvider(ctx);
  const row = await loadInstance(ctx, member, id);
  const token = await openToken(ctx, vault, row);
  try {
    await provider.logout(token);
  } catch (err) {
    providerFailure(err);
  }
  return toPublic(await updateRow(ctx, row, { status: 'disconnected', phoneE164: null, connectedAt: null, lastStatusAt: new Date() }));
}

export async function deleteInstance(ctx: WhatsAppContext, member: Member, id: string): Promise<void> {
  requireManager(member);
  const { provider } = await readyProvider(ctx);
  const row = await loadInstance(ctx, member, id);
  try {
    const providerId = row.providerInstanceId ?? (await provider.findInstanceId(row.providerInstanceName));
    if (providerId) await provider.deleteInstance(providerId);
  } catch (err) {
    // Já não existe na Evolution: segue com a exclusão no DisparaZap
    if (!(err instanceof ProviderError && err.kind === 'not_found')) providerFailure(err);
  }
  const now = new Date();
  await ctx.db.transaction(async (tx) => {
    await tx.update(whatsappInstances).set({ deletedAt: now, updatedAt: now, status: 'disconnected' }).where(eq(whatsappInstances.id, row.id));
    if (row.credentialId) await tx.update(integrationCredentials).set({ revokedAt: now }).where(eq(integrationCredentials.id, row.credentialId));
  });
}

/** Super-Admin: todas as instâncias ativas, com a empresa (só leitura) */
export async function listAllInstances(ctx: WhatsAppContext) {
  const rows = await ctx.db
    .select({ instance: whatsappInstances, organization: { id: organizations.id, name: organizations.name } })
    .from(whatsappInstances)
    .innerJoin(organizations, eq(organizations.id, whatsappInstances.organizationId))
    .where(isNull(whatsappInstances.deletedAt))
    .orderBy(asc(organizations.name), asc(whatsappInstances.createdAt));
  const synced = await syncWithServer(
    ctx,
    rows.map((row) => row.instance),
  );
  return { instances: rows.map((row, index) => ({ ...toPublic(synced[index] ?? row.instance), organization: row.organization })) };
}
