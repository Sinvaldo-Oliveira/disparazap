import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { betterAuth } from 'better-auth';
import { organization } from 'better-auth/plugins/organization';
import { createAccessControl } from 'better-auth/plugins/access';
import { adminAc, defaultStatements, memberAc, ownerAc } from 'better-auth/plugins/organization/access';
import { AUTH_BASE_PATH, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@disparazap/contracts';
import { accounts, invitations, members, organizations, sessions, users, verifications, type AppDatabase } from '@disparazap/db';
import { trustedOrigins, type ApiConfig } from '../config/env.ts';
import { hashPassword, verifyPassword } from './password.ts';

/** Cabeçalho interno com o IP do cliente, preenchido pela própria API (o valor vindo de fora é descartado) */
export const CLIENT_IP_HEADER = 'x-dz-client-ip';

// Papéis dentro da empresa (ARQUITETURA_SAAS §4.2): só owner e admin administram membros e convites
const ac = createAccessControl(defaultStatements);
const organizationRoles = {
  owner: ac.newRole(ownerAc.statements),
  admin: ac.newRole(adminAc.statements),
  operator: ac.newRole(memberAc.statements),
  viewer: ac.newRole(memberAc.statements),
};

type AuthLogLevel = 'debug' | 'info' | 'warn' | 'error';
export type AuthLogFn = (level: AuthLogLevel, message: string) => void;

export interface CreateAuthOptions {
  db: AppDatabase;
  config: ApiConfig;
  /** Segredo de assinatura dos cookies (AUTH_SECRET ou um valor temporário fora de produção) */
  secret: string;
  log: AuthLogFn;
}

export function createAuth({ db, config, secret, log }: CreateAuthOptions) {
  const production = config.NODE_ENV === 'production';

  return betterAuth({
    appName: 'DisparaZap',
    baseURL: config.AUTH_BASE_URL,
    basePath: AUTH_BASE_PATH,
    secret,
    trustedOrigins: trustedOrigins(config),
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: users,
        session: sessions,
        account: accounts,
        verification: verifications,
        organization: organizations,
        member: members,
        invitation: invitations,
      },
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      autoSignIn: true,
      requireEmailVerification: false,
      revokeSessionsOnPasswordReset: true,
      password: { hash: hashPassword, verify: verifyPassword },
    },
    user: {
      additionalFields: {
        // Nunca aceitos do navegador: só o servidor define (input: false)
        platformRole: { type: 'string', required: false, input: false },
        origin: { type: 'string', required: false, defaultValue: 'direct', input: false },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 dias
      updateAge: 60 * 60 * 24, // renova a validade uma vez por dia de uso
      // Sem cache de sessão em cookie: uma sessão revogada deixa de valer na hora
      cookieCache: { enabled: false },
    },
    disabledPaths: [
      // O cadastro público passa por /api/internal/signup (cria a conta e a empresa juntas)
      '/sign-up/email',
      // Auditoria A1: estas rotas devolviam o token da sessão ao JavaScript. O painel usa /api/internal/me.
      '/get-session',
      '/list-sessions',
      // Auditoria A5: convites desligados até existir verificação de e-mail (quem criasse conta com o e-mail convidado entraria na empresa)
      '/organization/invite-member',
      '/organization/accept-invitation',
      '/organization/reject-invitation',
      '/organization/cancel-invitation',
      '/organization/get-invitation',
      '/organization/list-invitations',
      '/organization/list-user-invitations',
    ],
    rateLimit: {
      enabled: config.NODE_ENV !== 'test',
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 10 },
      },
    },
    advanced: {
      // Proteção contra requisições de outros sites SEMPRE ligada. Sem isto, o Better Auth a desliga sozinho em ambiente de teste.
      disableOriginCheck: false,
      disableCSRFCheck: false,
      cookiePrefix: 'dz',
      useSecureCookies: production,
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', path: '/' },
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
    },
    telemetry: { enabled: false },
    logger: {
      level: config.LOG_LEVEL === 'debug' || config.LOG_LEVEL === 'trace' ? 'debug' : 'warn',
      // Só a mensagem: os argumentos extras podem trazer dados pessoais (ex.: detalhe de erro do banco)
      log: (level, message) => log(level, message),
    },
    plugins: [
      organization({
        ac,
        roles: organizationRoles,
        creatorRole: 'owner',
        // Empresas nascem no cadastro ou pelo Super-Admin, nunca por chamada direta do navegador
        allowUserToCreateOrganization: false,
        disableOrganizationDeletion: true,
        schema: {
          organization: {
            additionalFields: {
              origin: { type: 'string', required: false, defaultValue: 'direct', input: false },
            },
          },
        },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
