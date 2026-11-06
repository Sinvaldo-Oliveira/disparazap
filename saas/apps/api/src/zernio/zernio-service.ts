import { randomUUID, timingSafeEqual } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import {
  ZERNIO_PLATFORMS,
  ZERNIO_PLATFORM_LABELS,
  ZERNIO_RETURN_PARAM,
  ZERNIO_RETURN_ROUTE,
  type ZernioAccount,
  type ZernioAccountsResponse,
  type ZernioPlatform,
  type ZernioReturnResult,
  type ZernioStatus,
} from '@disparazap/contracts';
import { integrationCredentials, organizations, zernioConnections, type AppDatabase } from '@disparazap/db';
import type { ZernioInboxAccessOutcome, ZernioInboxAccessResult } from '@disparazap/contracts';
import { canManage, type Member } from '../auth/member.ts';
import { ZernioError, type ZernioAccountHealth, type ZernioAccountInfo, type ZernioClient, type ZernioClientFactory, type ZernioProfile } from '../integrations/zernio-client.ts';
import { VaultError, lastFour, type Vault } from '../security/vault.ts';

/**
 * Integração de cada empresa com a PRÓPRIA conta Zernio (PLANO_MODULO_ZERNIO): a chave fica cifrada no cofre, o perfil
 * da empresa é criado ou reaproveitado na conta Zernio dela, e as redes conectadas são lidas na Zernio a cada pedido.
 */
export interface ZernioContext {
  db: AppDatabase;
  vault: Vault | null;
  clientFactory: ZernioClientFactory;
  /** Endereço público do painel (AUTH_BASE_URL): a Zernio devolve a pessoa para lá depois da autorização */
  panelOrigin: string;
  /** Relógio em milissegundos (os testes trocam para conferir a validade do comprovante) */
  now?: () => number;
}

/** O que a Zernio respondeu, para o log do servidor (só códigos e números; nunca chave, texto ou dado pessoal) */
export type ZernioDiagnostic = Readonly<Record<string, string | number | boolean | null>>;

export class ZernioServiceError extends Error {
  readonly status: number;
  readonly diagnostic: ZernioDiagnostic | null;
  constructor(status: number, message: string, diagnostic: ZernioDiagnostic | null = null) {
    super(message);
    this.name = 'ZernioServiceError';
    this.status = status;
    this.diagnostic = diagnostic;
  }
}

const PROVIDER = 'zernio';
const KEY_KIND = 'api_key';
/** Contexto do cofre: a chave cifrada de uma empresa não abre como se fosse de outra */
const keyContext = (organizationId: string) => `${PROVIDER}:${KEY_KIND}:${organizationId}`;
const SIGN_PURPOSE = 'zernio-connect-return';
/** Validade do comprovante de volta: tempo para autorizar na rede e voltar */
const RETURN_TTL_SECONDS = 15 * 60;

const MANAGERS_ONLY = 'Só o dono e os administradores da empresa configuram a Zernio e conectam redes.';
const NOT_CONFIGURED = 'A integração com a Zernio ainda não foi configurada nesta empresa.';
const NO_VAULT = 'O cofre de credenciais não está configurado no servidor (SECRETS_MASTER_KEY). Avise o administrador da plataforma.';
const KEY_REFUSED = 'A Zernio recusou a chave guardada (revogada ou trocada). Cadastre uma chave nova em "Trocar chave".';
const BAD_RETURN = 'O retorno da Zernio não é válido ou expirou. Clique em Conectar de novo.';
const ACCOUNT_NOT_FOUND = 'Conta não encontrada nesta integração.';

/** Motivos da volta com erro (a lista da Zernio não é fechada: o que não está aqui recebe a mensagem geral) */
const RETURN_ERRORS: Readonly<Record<string, string>> = {
  oauth_denied: 'A autorização foi cancelada na rede. Nada foi conectado.',
  access_denied: 'A autorização foi cancelada na rede. Nada foi conectado.',
  no_facebook_pages: 'Esta conta do Facebook não administra nenhuma Página. A Zernio conecta só Páginas do Facebook.',
  account_mismatch: 'Você entrou na rede com uma conta diferente da esperada. Entre com a conta certa e tente de novo.',
  reconnect_account_mismatch: 'Para reconectar, entre na rede com a mesma conta que estava conectada.',
  missing_tiktok_permissions: 'Faltaram permissões no TikTok. Autorize todas as permissões pedidas e tente de novo.',
  code_already_redeemed: 'Este retorno já foi usado. Confira a lista de redes conectadas.',
};
const RETURN_ERROR_DEFAULT = 'A rede não concluiu a conexão. Tente de novo; se continuar, veja o motivo no painel da Zernio.';

export type ConnectionRow = typeof zernioConnections.$inferSelect;

function requireManager(member: Member) {
  if (!canManage(member)) throw new ZernioServiceError(403, MANAGERS_ONLY);
}

export function requireVault(ctx: ZernioContext): Vault {
  if (!ctx.vault) throw new ZernioServiceError(503, NO_VAULT);
  return ctx.vault;
}

export async function loadConnection(ctx: ZernioContext, member: Member): Promise<ConnectionRow | null> {
  const [row] = await ctx.db.select().from(zernioConnections).where(eq(zernioConnections.organizationId, member.organizationId)).limit(1);
  return row ?? null;
}

async function loadCredential(ctx: ZernioContext, row: ConnectionRow) {
  const [credential] = await ctx.db
    .select()
    .from(integrationCredentials)
    .where(and(eq(integrationCredentials.id, row.credentialId), eq(integrationCredentials.organizationId, row.organizationId)))
    .limit(1);
  if (!credential || credential.revokedAt) throw new ZernioServiceError(409, KEY_REFUSED);
  return credential;
}

async function setStatus(ctx: ZernioContext, row: ConnectionRow, status: 'active' | 'invalid') {
  await ctx.db.update(zernioConnections).set({ status, lastCheckAt: new Date(), updatedAt: new Date() }).where(eq(zernioConnections.organizationId, row.organizationId));
}

const detailNumber = (err: ZernioError, key: string): number | null => {
  const value = err.details?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

/**
 * Cobrança da Zernio (402): a mensagem depende do motivo que a Zernio informa (REFERENCIA_ZERNIO §2).
 * As redes grátis contam a conta Zernio inteira (todos os perfis e o painel da Zernio), e o X exige cartão desde a 1ª.
 */
function paymentMessage(err: ZernioError): string {
  switch (err.reason) {
    case 'twitter_passthrough':
      return 'O X (Twitter) exige um cartão cadastrado na sua conta Zernio desde a primeira conta, porque a Zernio repassa o custo do X por post: as 2 redes grátis não valem para o X. Cadastre o cartão na cobrança da Zernio e tente de novo.';
    case 'free_tier_exceeded': {
      const limit = detailNumber(err, 'free_tier_account_limit') ?? 2;
      const current = detailNumber(err, 'current_account_count');
      return (
        `O plano grátis da Zernio permite ${limit} redes conectadas na conta Zernio inteira${current !== null ? `, e a sua já tem ${current}` : ''}. ` +
        'A contagem inclui redes conectadas direto no painel da Zernio ou em outros perfis, não só pelo DisparaZap: a mesma rede conectada em dois perfis conta duas vezes. ' +
        'Para conectar mais, cadastre um cartão na cobrança da Zernio (cobrança por rede a mais) ou desconecte uma rede que não usa.'
      );
    }
    case 'card_verification_required': {
      const cents = detailNumber(err, 'verification_amount_cents');
      const amount = cents !== null ? ` (cobrança única de US$ ${(cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}, que vira crédito de uso)` : '';
      return `A Zernio precisa verificar o cartão cadastrado${amount}. Conclua a verificação na cobrança da Zernio e tente de novo.`;
    }
    case 'enterprise_required':
      return 'A sua conta Zernio atingiu o limite de redes do contrato empresarial. Fale com a Zernio para aumentar o limite.';
    default:
      return err.message;
  }
}

/** Converte a falha da Zernio em resposta da API (mensagens fixas). Chave recusada marca a integração como inválida */
export async function fromZernio(ctx: ZernioContext, row: ConnectionRow | null, err: unknown, extra: ZernioDiagnostic = {}): Promise<never> {
  if (!(err instanceof ZernioError)) throw err;
  const diagnostic: ZernioDiagnostic = {
    ...extra,
    tipo: err.kind,
    status: err.httpStatus,
    codigo: err.code,
    motivo: err.reason,
    limite: detailNumber(err, 'free_tier_account_limit'),
    contas: detailNumber(err, 'current_account_count'),
  };
  if (err.kind === 'unauthorized') {
    if (row) await setStatus(ctx, row, 'invalid');
    throw new ZernioServiceError(409, KEY_REFUSED, diagnostic);
  }
  if (err.kind === 'rate_limited') throw new ZernioServiceError(429, err.message, diagnostic);
  if (err.kind === 'payment_required') throw new ZernioServiceError(402, paymentMessage(err), diagnostic);
  if (err.kind === 'forbidden' || err.kind === 'platform_unavailable') throw new ZernioServiceError(409, err.message, diagnostic);
  throw new ZernioServiceError(502, err.message, diagnostic);
}

/** Cliente da Zernio com a chave guardada da empresa */
export async function readyClient(ctx: ZernioContext, member: Member): Promise<{ row: ConnectionRow; client: ZernioClient }> {
  const vault = requireVault(ctx);
  const row = await loadConnection(ctx, member);
  if (!row) throw new ZernioServiceError(409, NOT_CONFIGURED);
  const credential = await loadCredential(ctx, row);
  let apiKey: string;
  try {
    apiKey = vault.open(credential, keyContext(member.organizationId));
  } catch (err) {
    // Chave-mestra do servidor trocada (ou dado adulterado): a chave guardada não abre mais
    if (err instanceof VaultError) throw new ZernioServiceError(409, 'A chave guardada não pôde ser aberta (a chave-mestra do servidor mudou). Cadastre a chave da Zernio de novo.');
    throw err;
  }
  return { row, client: ctx.clientFactory(apiKey) };
}

// ----- Situação, chave e perfil -----

export async function getZernioStatus(ctx: ZernioContext, member: Member): Promise<ZernioStatus> {
  const row = await loadConnection(ctx, member);
  let keyLast4: string | null = null;
  if (row) {
    const [credential] = await ctx.db.select({ last4: integrationCredentials.last4 }).from(integrationCredentials).where(eq(integrationCredentials.id, row.credentialId)).limit(1);
    keyLast4 = credential?.last4 ?? null;
  }
  return {
    available: ctx.vault !== null,
    configured: row !== null,
    status: row ? (row.status === 'invalid' ? 'invalid' : 'active') : null,
    keyLast4,
    accountName: row?.accountName ?? null,
    profileName: row?.profileName ?? null,
    lastCheckAt: row?.lastCheckAt?.toISOString() ?? null,
    canManage: canManage(member),
  };
}

/** Perfil da empresa na conta Zernio dela (decisão Z4): reaproveita pelo externalId ou cria "DisparaZap — empresa" */
async function ensureProfile(client: ZernioClient, organizationId: string, organizationName: string): Promise<ZernioProfile> {
  const existing = await client.findProfileByExternalId(organizationId);
  if (existing) return existing;
  const name = `DisparaZap — ${organizationName}`.slice(0, 90);
  const description = 'Perfil usado pelo painel DisparaZap. As redes conectadas por ele aparecem aqui.';
  try {
    return await client.createProfile({ name, externalId: organizationId, description });
  } catch (err) {
    if (!(err instanceof ZernioError) || err.kind !== 'conflict') throw err;
    const existingId = typeof err.details?.existingProfileId === 'string' ? err.details.existingProfileId : null;
    if (err.code === 'profile_external_id_conflict' && existingId) {
      const profile = await client.getProfile(existingId);
      if (profile) return profile;
    }
    // Já existe um perfil com esse nome (criado à mão, sem externalId): cria outro com um sufixo
    if (err.code === 'profile_name_conflict') return client.createProfile({ name: `${name} (${organizationId.slice(0, 8)})`, externalId: organizationId, description });
    throw err;
  }
}

/** Testa a chave na Zernio e só então guarda (cifrada). Trocar a chave reaproveita o perfil da empresa */
export async function saveZernioKey(ctx: ZernioContext, member: Member, apiKey: string): Promise<ZernioStatus> {
  requireManager(member);
  const vault = requireVault(ctx);
  const client = ctx.clientFactory(apiKey);
  let accountName: string | null;
  let profile: ZernioProfile;
  try {
    accountName = (await client.verify()).name;
    const [organization] = await ctx.db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, member.organizationId)).limit(1);
    profile = await ensureProfile(client, member.organizationId, organization?.name ?? 'empresa');
  } catch (err) {
    if (err instanceof ZernioError && err.kind === 'unauthorized') {
      throw new ZernioServiceError(400, 'A Zernio recusou esta chave. Confira se copiou a chave inteira e se ela não foi revogada no painel da Zernio.');
    }
    return fromZernio(ctx, null, err);
  }

  const now = new Date();
  await ctx.db.transaction(async (tx) => {
    const credentialId = randomUUID();
    await tx.insert(integrationCredentials).values({
      id: credentialId,
      organizationId: member.organizationId,
      provider: PROVIDER,
      kind: KEY_KIND,
      ...vault.seal(apiKey, keyContext(member.organizationId)),
      last4: lastFour(apiKey),
      createdBy: member.userId,
    });
    const values = { credentialId, profileId: profile.id, profileName: profile.name, accountName, status: 'active', lastCheckAt: now, updatedAt: now };
    // Primeira chave da empresa: insere. Se já existe (ou outra gravação chegou antes), trava a linha e troca a chave
    const inserted = await tx
      .insert(zernioConnections)
      .values({ organizationId: member.organizationId, createdBy: member.userId, ...values })
      .onConflictDoNothing()
      .returning({ organizationId: zernioConnections.organizationId });
    if (inserted.length) return;
    const [previous] = await tx.select().from(zernioConnections).where(eq(zernioConnections.organizationId, member.organizationId)).limit(1).for('update');
    await tx.update(zernioConnections).set(values).where(eq(zernioConnections.organizationId, member.organizationId));
    // A chave anterior sai do cofre: só uma chave da Zernio por empresa
    if (previous && previous.credentialId !== credentialId) {
      await tx.delete(integrationCredentials).where(and(eq(integrationCredentials.id, previous.credentialId), eq(integrationCredentials.organizationId, member.organizationId)));
    }
  });
  return getZernioStatus(ctx, member);
}

/** Tira a chave do DisparaZap. Nada muda na conta da Zernio: as redes continuam conectadas lá */
export async function removeZernioKey(ctx: ZernioContext, member: Member): Promise<void> {
  requireManager(member);
  const row = await loadConnection(ctx, member);
  if (!row) throw new ZernioServiceError(404, NOT_CONFIGURED);
  await ctx.db.transaction(async (tx) => {
    await tx.delete(zernioConnections).where(eq(zernioConnections.organizationId, member.organizationId));
    await tx.delete(integrationCredentials).where(and(eq(integrationCredentials.id, row.credentialId), eq(integrationCredentials.organizationId, member.organizationId)));
  });
}

// ----- Redes conectadas -----

const safeProfileUrl = (value: string | null): string | null => {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
};

function toPublicAccount(info: ZernioAccountInfo, health: ZernioAccountHealth | undefined): ZernioAccount {
  const needsReconnect = info.needsReconnection || !info.isActive || health?.needsReconnect === true || health?.tokenValid === false;
  const warning = health?.status === 'warning' || health?.status === 'error';
  return {
    id: info.id,
    platform: info.platform,
    username: info.username,
    displayName: info.displayName,
    profileUrl: safeProfileUrl(info.profileUrl),
    state: needsReconnect ? 'needs_reconnect' : warning ? 'warning' : 'ok',
  };
}

/** Só as contas do perfil desta empresa (conta sem perfil informado não conta como da empresa) */
async function profileAccounts(client: ZernioClient, row: ConnectionRow): Promise<ZernioAccountInfo[]> {
  return (await client.listAccounts(row.profileId)).filter((account) => account.profileId === row.profileId);
}

/** Contas do perfil, com a situação, para a tela. A saúde é complementar: se falhar, a lista sai mesmo assim */
export async function readAccounts(client: ZernioClient, row: ConnectionRow): Promise<ZernioAccount[]> {
  const [accounts, health] = await Promise.all([profileAccounts(client, row), client.accountsHealth(row.profileId).catch(() => [] as ZernioAccountHealth[])]);
  const byId = new Map(health.map((item) => [item.accountId, item]));
  return accounts.map((account) => toPublicAccount(account, byId.get(account.id)));
}

export async function listZernioAccounts(ctx: ZernioContext, member: Member): Promise<ZernioAccountsResponse> {
  const { row, client } = await readyClient(ctx, member);
  try {
    // O total da conta inteira é complementar: se a Zernio não informar, a lista do perfil sai mesmo assim
    const [accounts, team, profiles] = await Promise.all([
      readAccounts(client, row),
      client.listTeamAccounts().catch(() => null),
      client.listProfiles().catch(() => [] as ZernioProfile[]),
    ]);
    const profileNames = new Map(profiles.map((profile) => [profile.id, profile.name]));
    const outsideAccounts = (team ?? [])
      .filter((account) => account.profileId !== row.profileId)
      .slice(0, 20)
      .map((account) => ({ platform: account.platform, username: account.username, profileName: account.profileId ? (profileNames.get(account.profileId) ?? null) : null }));
    // A chave voltou a funcionar (ex.: problema passageiro): a integração volta a ficar ativa
    if (row.status === 'invalid') await setStatus(ctx, row, 'active');
    return { accounts, teamAccountCount: team ? team.length : null, outsideAccounts, canManage: canManage(member) };
  } catch (err) {
    return fromZernio(ctx, row, err);
  }
}

// ----- Teste de acesso à Inbox (só leitura, administradores) -----

const INBOX_MESSAGES: Readonly<Record<ZernioInboxAccessOutcome, string>> = {
  confirmed: 'Acesso confirmado: a Zernio respondeu à consulta de leitura. Nenhum conteúdo de mensagem foi lido nem guardado.',
  unavailable: 'Recurso indisponível: a Zernio informou falta de permissão ou de complemento para a Inbox desta conta. Confira o motivo no painel da Zernio.',
  auth_failed: 'Falha de autenticação: a Zernio recusou a chave guardada. Cadastre uma chave nova em "Trocar chave".',
  temporary: 'Falha temporária: a Zernio está indisponível ou pediu uma pausa. Tente de novo em instantes.',
  inconclusive: 'Diagnóstico inconclusivo: a Zernio respondeu de um jeito não previsto. Tente de novo; se continuar, avise o suporte com a hora do teste.',
};

/**
 * Consulta de leitura à Inbox da Zernio, para o perfil desta empresa, com 1 conversa no máximo. Não grava nada e não muda a
 * situação da integração (nem a chave recusada fica marcada): é só um diagnóstico. Um 403 não é tomado como "sem add-on":
 * o resultado é "recurso indisponível", com o código que a Zernio devolveu.
 */
export async function testInboxAccess(ctx: ZernioContext, member: Member): Promise<{ result: ZernioInboxAccessResult; upstreamStatus: number | null; shape: string[] | null }> {
  if (!canManage(member)) throw new ZernioServiceError(403, MANAGERS_ONLY);
  const { row, client } = await readyClient(ctx, member);
  const checkedAt = new Date().toISOString();
  const done = (outcome: ZernioInboxAccessOutcome, code: string | null, hasConversations: boolean | null, upstreamStatus: number | null, shape: string[] | null = null) => ({
    result: { outcome, message: INBOX_MESSAGES[outcome], code, hasConversations, checkedAt },
    upstreamStatus,
    shape,
  });
  try {
    const probe = await client.inboxProbe(row.profileId);
    if (probe.conversations === null) return done('inconclusive', null, null, null, probe.keys);
    return done('confirmed', null, probe.conversations > 0, null);
  } catch (err) {
    if (!(err instanceof ZernioError)) throw err;
    // Só códigos curtos no formato conhecido: nada que venha da Zernio em texto livre chega à tela ou ao log
    const code = err.code && /^[a-z0-9_]{1,60}$/i.test(err.code) ? err.code : null;
    const upstream = err.httpStatus;
    switch (err.kind) {
      case 'unauthorized':
        return done('auth_failed', code, null, upstream);
      case 'forbidden':
      case 'payment_required':
      case 'platform_unavailable':
        return done('unavailable', code, null, upstream);
      case 'rate_limited':
      case 'unreachable':
        return done('temporary', code, null, upstream);
      case 'failed':
        return done(upstream !== null && upstream >= 500 ? 'temporary' : 'inconclusive', code, null, upstream);
      default:
        return done('inconclusive', code, null, upstream);
    }
  }
}

// ----- Comprovante da volta da autorização -----

/** Assinado com subchave do cofre; ligado à empresa, ao usuário, à rede e à validade. Curto (o X limita a URL de volta) */
function signReturn(vault: Vault, member: Member, platform: ZernioPlatform, expires: number): string {
  return vault.sign(SIGN_PURPOSE, `${member.organizationId}|${member.userId}|${platform}|${expires}`);
}

export function createReturnToken(ctx: ZernioContext, member: Member, platform: ZernioPlatform): string {
  const vault = requireVault(ctx);
  const expires = Math.floor((ctx.now?.() ?? Date.now()) / 1000) + RETURN_TTL_SECONDS;
  return `${platform}.${expires}.${signReturn(vault, member, platform, expires)}`;
}

/** Confere o comprovante com a sessão atual: de outra empresa, de outro usuário, alterado ou vencido → recusado */
export function verifyReturnToken(ctx: ZernioContext, member: Member, token: string): ZernioPlatform {
  const vault = requireVault(ctx);
  const [platform, expiresText, signature, ...rest] = token.split('.');
  if (rest.length || !platform || !expiresText || !signature || !(ZERNIO_PLATFORMS as readonly string[]).includes(platform) || !/^\d{1,12}$/.test(expiresText)) {
    throw new ZernioServiceError(400, BAD_RETURN);
  }
  const expires = Number(expiresText);
  const expected = Buffer.from(signReturn(vault, member, platform as ZernioPlatform, expires));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) throw new ZernioServiceError(400, BAD_RETURN);
  if (Math.floor((ctx.now?.() ?? Date.now()) / 1000) > expires) throw new ZernioServiceError(400, BAD_RETURN);
  return platform as ZernioPlatform;
}

// ----- Conectar, voltar e desconectar -----

export async function startZernioConnect(ctx: ZernioContext, member: Member, input: { platform: ZernioPlatform; reconnectAccountId: string | null }): Promise<{ authUrl: string }> {
  requireManager(member);
  const { row, client } = await readyClient(ctx, member);
  try {
    if (input.reconnectAccountId) {
      const accounts = await profileAccounts(client, row);
      if (!accounts.some((account) => account.id === input.reconnectAccountId)) throw new ZernioServiceError(404, ACCOUNT_NOT_FOUND);
    }
    const token = createReturnToken(ctx, member, input.platform);
    const redirectUrl = `${ctx.panelOrigin}${ZERNIO_RETURN_ROUTE}?${ZERNIO_RETURN_PARAM}=${token}`;
    const authUrl = await client.connectUrl({ platform: input.platform, profileId: row.profileId, redirectUrl, reconnectAccountId: input.reconnectAccountId });
    return { authUrl };
  } catch (err) {
    if (err instanceof ZernioServiceError) throw err;
    if (err instanceof ZernioError && err.kind === 'not_found') {
      throw new ZernioServiceError(409, 'O perfil do DisparaZap não existe mais na sua conta Zernio. Salve a chave de novo ("Trocar chave") para recriá-lo.');
    }
    return fromZernio(ctx, row, err, { rede: input.platform, reconexao: input.reconnectAccountId !== null });
  }
}

const accountLabel = (account: ZernioAccount) => account.displayName ?? (account.username ? `@${account.username}` : 'conta');

/** Volta da autorização: confere o comprovante e relê as contas na Zernio (nunca confia só no que veio na URL) */
export async function completeZernioConnect(
  ctx: ZernioContext,
  member: Member,
  input: { dz: string; accountId: string | null; error: string | null },
): Promise<ZernioReturnResult> {
  requireManager(member);
  const platform = verifyReturnToken(ctx, member, input.dz);
  if (input.error) return { ok: false, platform, account: null, message: Object.hasOwn(RETURN_ERRORS, input.error) ? (RETURN_ERRORS[input.error] as string) : RETURN_ERROR_DEFAULT };
  const { row, client } = await readyClient(ctx, member);
  let accounts: ZernioAccount[];
  try {
    accounts = await readAccounts(client, row);
  } catch (err) {
    return fromZernio(ctx, row, err);
  }
  const account = input.accountId ? accounts.find((candidate) => candidate.id === input.accountId) : undefined;
  if (!account) {
    return { ok: false, platform, account: null, message: 'A conexão não apareceu na sua conta Zernio. Atualize a lista de redes em instantes.' };
  }
  const label = (ZERNIO_PLATFORM_LABELS as Readonly<Record<string, string>>)[account.platform] ?? ZERNIO_PLATFORM_LABELS[platform];
  return { ok: true, platform, account, message: `${label} conectado: ${accountLabel(account)}.` };
}

/** Desconecta na Zernio, só contas do perfil desta empresa */
export async function disconnectZernioAccount(ctx: ZernioContext, member: Member, accountId: string): Promise<void> {
  requireManager(member);
  const { row, client } = await readyClient(ctx, member);
  try {
    const accounts = await profileAccounts(client, row);
    if (!accounts.some((account) => account.id === accountId)) throw new ZernioServiceError(404, ACCOUNT_NOT_FOUND);
    await client.deleteAccount(accountId);
  } catch (err) {
    if (err instanceof ZernioServiceError) throw err;
    // Já tinha saído na Zernio (ex.: desconectada lá): o resultado é o mesmo
    if (err instanceof ZernioError && err.kind === 'not_found') return;
    return fromZernio(ctx, row, err);
  }
}
