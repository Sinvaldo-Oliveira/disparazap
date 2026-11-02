import { and, asc, eq } from 'drizzle-orm';
import { ORGANIZATION_ROLES, sessionInfoSchema, type OrganizationRole, type SessionInfo, type UserType } from '@disparazap/contracts';
import { members, organizations, type AppDatabase } from '@disparazap/db';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  platformRole?: string | null;
  origin?: string | null;
}

/** Super-Admin é papel global; os demais tipos dependem da origem da conta */
export function userTypeOf(user: Pick<SessionUser, 'platformRole' | 'origin'>): UserType {
  if (user.platformRole === 'super_admin') return 'super_admin';
  return user.origin === 'mylinksss' ? 'mylinksss_admin' : 'company_admin';
}

function isOrganizationRole(value: string): value is OrganizationRole {
  return (ORGANIZATION_ROLES as readonly string[]).includes(value);
}

/**
 * Monta a resposta de /api/internal/me: só campos permitidos (nada de hash, token ou dados de sessão).
 * A empresa vem da participação do usuário; a empresa ativa da sessão tem prioridade.
 */
export async function buildSessionInfo(db: AppDatabase, user: SessionUser, activeOrganizationId?: string | null): Promise<SessionInfo> {
  const filter = activeOrganizationId
    ? and(eq(members.userId, user.id), eq(members.organizationId, activeOrganizationId))
    : eq(members.userId, user.id);

  const [membership] = await db
    .select({ id: organizations.id, name: organizations.name, role: members.role })
    .from(members)
    .innerJoin(organizations, eq(organizations.id, members.organizationId))
    .where(filter)
    .orderBy(asc(members.createdAt))
    .limit(1);

  return sessionInfoSchema.parse({
    user: { id: user.id, name: user.name, email: user.email },
    userType: userTypeOf(user),
    organization:
      membership && isOrganizationRole(membership.role)
        ? { id: membership.id, name: membership.name, role: membership.role }
        : null,
  });
}
