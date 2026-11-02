import { and, asc, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ORGANIZATION_ROLES, PROBLEM_CONTENT_TYPE, type OrganizationRole } from '@disparazap/contracts';
import { members, type AppDatabase } from '@disparazap/db';
import { problem } from '../plugins/error-handler.ts';
import { authRequestHeaders } from '../routes/auth.ts';
import type { Auth } from './auth.ts';

/** Quem está agindo: empresa ativa da sessão e papel nela (nunca vindos do navegador) */
export interface Member {
  userId: string;
  organizationId: string;
  role: OrganizationRole;
}

declare module 'fastify' {
  interface FastifyRequest {
    member?: Member;
  }
}

const MANAGER_ROLES: ReadonlySet<OrganizationRole> = new Set(['owner', 'admin']);
const OPERATOR_ROLES: ReadonlySet<OrganizationRole> = new Set(['owner', 'admin', 'operator']);

/** Gerencia instâncias de WhatsApp (criar, conectar, excluir) */
export const canManage = (member: Member) => MANAGER_ROLES.has(member.role);
/** Salva listas de contatos e envia mensagens */
export const canOperate = (member: Member) => OPERATOR_ROLES.has(member.role);

const isRole = (value: string): value is OrganizationRole => (ORGANIZATION_ROLES as readonly string[]).includes(value);

export function sendProblem(request: FastifyRequest, reply: FastifyReply, status: number, detail?: string) {
  return reply.status(status).type(PROBLEM_CONTENT_TYPE).send(problem(request, status, detail));
}

/** preHandler das rotas das empresas: sem sessão → 401; sem empresa (ex.: Super-Admin da plataforma) → 403 */
export function registerMemberContext(app: FastifyInstance, { auth, db }: { auth: Auth; db: AppDatabase }) {
  app.addHook('preHandler', async (request, reply) => {
    const session = await auth.api.getSession({ headers: authRequestHeaders(request) });
    if (!session) return sendProblem(request, reply, 401);
    const active = session.session.activeOrganizationId;
    const [membership] = await db
      .select({ organizationId: members.organizationId, role: members.role })
      .from(members)
      .where(active ? and(eq(members.userId, session.user.id), eq(members.organizationId, active)) : eq(members.userId, session.user.id))
      .orderBy(asc(members.createdAt))
      .limit(1);
    if (!membership || !isRole(membership.role)) return sendProblem(request, reply, 403, 'Sua conta não está ligada a uma empresa.');
    request.member = { userId: session.user.id, organizationId: membership.organizationId, role: membership.role };
  });
}
