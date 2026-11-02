import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import {
  evolutionSettingsSchema,
  evolutionTestResultSchema,
  normalizeEvolutionUrl,
  type ConnectionCheckStatus,
  type EvolutionSettings,
  type EvolutionSettingsInput,
  type EvolutionTestResult,
} from '@disparazap/contracts';
import { integrationCredentials, providerServers, type AppDatabase } from '@disparazap/db';
import { checkEvolutionConnection, type ConnectionCheck } from '../integrations/evolution-client.ts';
import { lastFour, type Vault } from '../security/vault.ts';

const PROVIDER = 'evolution_go';
const KIND = 'global_api_key';
/** Contexto autenticado no AES-GCM: o valor só abre como chave global da Evolution Go */
const VAULT_CONTEXT = `${PROVIDER}:${KIND}`;
const MIN_KEY_LENGTH = 8;

export class SettingsError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'SettingsError';
    this.status = status;
  }
}

const vaultUnavailable = () =>
  new SettingsError(503, 'O cofre de credenciais não está configurado no servidor (SECRETS_MASTER_KEY). A chave não foi salva.');

async function loadServer(db: AppDatabase) {
  const [row] = await db
    .select({ server: providerServers, credential: integrationCredentials })
    .from(providerServers)
    .leftJoin(integrationCredentials, eq(integrationCredentials.id, providerServers.credentialId))
    .where(eq(providerServers.provider, PROVIDER))
    .orderBy(asc(providerServers.createdAt))
    .limit(1);
  return row;
}

/** Configuração para a tela do Super-Admin: nunca inclui a chave, só se existe e os 4 últimos caracteres */
export async function getEvolutionSettings(db: AppDatabase, vault: Vault | null): Promise<EvolutionSettings> {
  const row = await loadServer(db);
  const credential = row?.credential && !row.credential.revokedAt ? row.credential : null;
  return evolutionSettingsSchema.parse({
    vaultReady: vault !== null,
    server: row
      ? {
          name: row.server.name,
          baseUrl: row.server.baseUrl,
          status: row.server.status,
          apiKey: { configured: credential !== null, last4: credential?.last4 ?? null },
          lastCheck: {
            at: row.server.lastCheckAt?.toISOString() ?? null,
            status: (row.server.lastCheckStatus as ConnectionCheckStatus | null) ?? null,
            detail: row.server.lastCheckDetail ?? null,
          },
          updatedAt: row.server.updatedAt.toISOString(),
        }
      : null,
  });
}

/**
 * Salva a integração global. A chave nova (se enviada) é cifrada e a anterior fica revogada.
 * Mudar o endereço ou a chave zera o resultado do último teste (ele não vale mais).
 */
export async function saveEvolutionSettings(
  db: AppDatabase,
  vault: Vault | null,
  input: EvolutionSettingsInput,
  actorId: string,
): Promise<{ settings: EvolutionSettings; keyReplaced: boolean }> {
  const apiKey = input.apiKey?.trim() ?? '';
  const baseUrl = normalizeEvolutionUrl(input.baseUrl);
  const existing = await loadServer(db);

  if (apiKey && apiKey.length < MIN_KEY_LENGTH) throw new SettingsError(400, `A chave global precisa ter pelo menos ${MIN_KEY_LENGTH} caracteres.`);
  if (!existing && !apiKey) throw new SettingsError(400, 'Informe a chave global da API (GLOBAL_API_KEY da Evolution Go).');
  if (apiKey && !vault) throw vaultUnavailable();

  const now = new Date();
  await db.transaction(async (tx) => {
    let credentialId = existing?.server.credentialId ?? null;
    if (apiKey && vault) {
      const sealed = vault.seal(apiKey, VAULT_CONTEXT);
      const newId = randomUUID();
      await tx.insert(integrationCredentials).values({
        id: newId,
        organizationId: null,
        provider: PROVIDER,
        kind: KIND,
        ...sealed,
        last4: lastFour(apiKey),
        createdBy: actorId,
      });
      if (credentialId) await tx.update(integrationCredentials).set({ revokedAt: now }).where(eq(integrationCredentials.id, credentialId));
      credentialId = newId;
    }

    const configChanged = Boolean(apiKey) || existing?.server.baseUrl !== baseUrl;
    const resetCheck = configChanged ? { lastCheckAt: null, lastCheckStatus: null, lastCheckDetail: null } : {};

    if (existing) {
      await tx
        .update(providerServers)
        .set({ name: input.name.trim(), baseUrl, status: input.status, credentialId, updatedBy: actorId, updatedAt: now, ...resetCheck })
        .where(eq(providerServers.id, existing.server.id));
    } else {
      await tx.insert(providerServers).values({
        id: randomUUID(),
        provider: PROVIDER,
        name: input.name.trim(),
        baseUrl,
        status: input.status,
        credentialId,
        createdBy: actorId,
        updatedBy: actorId,
      });
    }
  });

  return { settings: await getEvolutionSettings(db, vault), keyReplaced: Boolean(apiKey) };
}

export type ResolvedIntegration =
  | { state: 'ready'; serverId: string; baseUrl: string; globalKey: string }
  | { state: 'missing' | 'disabled' };

/**
 * Integração global para uso interno (módulo WhatsApp): servidor ativo e chave global aberta do cofre.
 * A chave nunca sai do processo da API.
 */
export async function resolveEvolutionIntegration(db: AppDatabase, vault: Vault | null): Promise<ResolvedIntegration> {
  const row = await loadServer(db);
  const credential = row?.credential && !row.credential.revokedAt ? row.credential : null;
  if (!row || !credential || !vault) return { state: 'missing' };
  if (row.server.status !== 'active') return { state: 'disabled' };
  return { state: 'ready', serverId: row.server.id, baseUrl: row.server.baseUrl, globalKey: vault.open(credential, VAULT_CONTEXT) };
}

export type ConnectionChecker = (baseUrl: string, apiKey: string) => Promise<ConnectionCheck>;

/** Testa a configuração salva (só leitura na Evolution Go) e guarda o resultado */
export async function testEvolutionSettings(
  db: AppDatabase,
  vault: Vault | null,
  check: ConnectionChecker = checkEvolutionConnection,
): Promise<EvolutionTestResult> {
  const row = await loadServer(db);
  const credential = row?.credential && !row.credential.revokedAt ? row.credential : null;
  if (!row || !credential) throw new SettingsError(409, 'Salve o endereço e a chave global antes de testar.');
  if (!vault) throw vaultUnavailable();

  const apiKey = vault.open(credential, VAULT_CONTEXT);
  const result = await check(row.server.baseUrl, apiKey);
  const at = new Date();
  await db
    .update(providerServers)
    .set({ lastCheckAt: at, lastCheckStatus: result.status, lastCheckDetail: result.detail })
    .where(eq(providerServers.id, row.server.id));

  return evolutionTestResultSchema.parse({ ...result, at: at.toISOString() });
}
