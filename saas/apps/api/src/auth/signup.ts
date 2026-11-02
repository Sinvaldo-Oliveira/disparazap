import { randomBytes, randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type { SignupRequest } from '@disparazap/contracts';
import { members, organizations, sessions, users, type AppDatabase } from '@disparazap/db';
import type { Auth } from './auth.ts';
import type { SessionUser } from './session-info.ts';

/** Recusa genérica: a mesma resposta para e-mail já usado e e-mail reservado (não revela qual é o caso) */
export class SignupRejectedError extends Error {
  constructor() {
    super('Não foi possível criar a conta com este e-mail.');
    this.name = 'SignupRejectedError';
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// "Clínica São José Ltda." → "clinica-sao-jose-ltda-a1b2c3": legível e sem colisão
export function organizationSlug(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return `${base || 'empresa'}-${randomBytes(3).toString('hex')}`;
}

export interface SignupDeps {
  auth: Auth;
  db: AppDatabase;
  reservedEmail?: string | undefined;
  /** Cabeçalhos da requisição original (IP, user agent) para o registro da sessão */
  headers: Headers;
}

export interface SignupResult {
  user: SessionUser;
  organizationId: string;
  /** Cabeçalhos Set-Cookie da sessão criada pelo Better Auth */
  setCookies: string[];
}

/**
 * Cadastro público: cria a conta (Better Auth, senha em argon2id) e a empresa com o usuário como "owner".
 * Se a empresa não puder ser criada, a conta é removida: não ficam contas sem empresa.
 */
export async function signupWithCompany(input: SignupRequest, deps: SignupDeps): Promise<SignupResult> {
  const email = normalizeEmail(input.email);
  if (deps.reservedEmail && normalizeEmail(deps.reservedEmail) === email) throw new SignupRejectedError();

  const [existing] = await deps.db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
  if (existing) throw new SignupRejectedError();

  let result;
  try {
    result = await deps.auth.api.signUpEmail({
      body: { name: input.name.trim(), email, password: input.password },
      headers: deps.headers,
      returnHeaders: true,
    });
  } catch (err) {
    // Corrida entre dois cadastros com o mesmo e-mail: o índice único recusa o segundo
    const [raced] = await deps.db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
    if (raced) throw new SignupRejectedError();
    throw err;
  }

  const userId = result.response.user.id;
  const organizationId = randomUUID();
  try {
    await deps.db.transaction(async (tx) => {
      await tx.insert(organizations).values({
        id: organizationId,
        name: input.companyName.trim(),
        slug: organizationSlug(input.companyName),
        origin: 'direct',
      });
      await tx.insert(members).values({ id: randomUUID(), organizationId, userId, role: 'owner' });
      if (result.response.token) {
        await tx.update(sessions).set({ activeOrganizationId: organizationId }).where(eq(sessions.token, result.response.token));
      }
    });
  } catch (err) {
    await deps.db.delete(users).where(eq(users.id, userId));
    throw err;
  }

  return {
    user: { id: userId, name: result.response.user.name, email: result.response.user.email, platformRole: null, origin: 'direct' },
    organizationId,
    setCookies: result.headers.getSetCookie(),
  };
}
