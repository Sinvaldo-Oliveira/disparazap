import { eq, sql } from 'drizzle-orm';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@disparazap/contracts';
import { sessions, users, type AppDatabase } from '@disparazap/db';
import type { Auth } from './auth.ts';
import { normalizeEmail } from './signup.ts';

export class SuperAdminError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SuperAdminError';
  }
}

export type SuperAdminOutcome = 'created' | 'already_super_admin';

export interface CreateSuperAdminInput {
  auth: Auth;
  db: AppDatabase;
  email: string;
  name: string;
  password: string;
}

/**
 * Cria o Super-Admin (papel global, sem empresa). Usado só pelo comando de terminal `npm run admin:create`.
 * - A senha é digitada na hora e guardada só como hash argon2id: nunca fica em arquivo.
 * - Uma conta comum já existente com o mesmo e-mail NÃO é promovida: quem a criou pode não ser o dono do e-mail.
 */
export async function createSuperAdmin({ auth, db, email, name, password }: CreateSuperAdminInput): Promise<SuperAdminOutcome> {
  const normalized = normalizeEmail(email);
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    throw new SuperAdminError(`A senha precisa ter entre ${PASSWORD_MIN_LENGTH} e ${PASSWORD_MAX_LENGTH} caracteres.`);
  }
  if (name.trim().length < 2) throw new SuperAdminError('Informe o nome do Super-Admin.');

  const [existing] = await db
    .select({ id: users.id, platformRole: users.platformRole })
    .from(users)
    .where(sql`lower(${users.email}) = ${normalized}`)
    .limit(1);
  if (existing?.platformRole === 'super_admin') return 'already_super_admin';
  if (existing) {
    throw new SuperAdminError(
      'Já existe uma conta comum com este e-mail. Por segurança, ela não é promovida automaticamente: use outro e-mail ou remova a conta antes.',
    );
  }

  const result = await auth.api.signUpEmail({ body: { name: name.trim(), email: normalized, password } });
  const userId = result.user.id;
  await db.update(users).set({ platformRole: 'super_admin' }).where(eq(users.id, userId));
  // O cadastro abre uma sessão automaticamente; o terminal não precisa dela
  await db.delete(sessions).where(eq(sessions.userId, userId));
  return 'created';
}
