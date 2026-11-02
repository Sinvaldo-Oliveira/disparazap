import { z } from 'zod';

// Rotas de autenticação conhecidas pela API e pelo painel (mesma origem)
export const AUTH_BASE_PATH = '/api/auth';
export const INTERNAL_API_PREFIX = '/api/internal';
export const SESSION_PATH = `${INTERNAL_API_PREFIX}/me`;
export const SIGNUP_PATH = `${INTERNAL_API_PREFIX}/signup`;
export const SIGN_IN_PATH = `${AUTH_BASE_PATH}/sign-in/email`;
export const SIGN_OUT_PATH = `${AUTH_BASE_PATH}/sign-out`;

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * Tipos de usuário do DisparaZap:
 * - super_admin: administra a plataforma inteira (papel global, sem empresa);
 * - company_admin: administra a própria empresa, cadastrada direto no DisparaZap;
 * - mylinksss_admin: administra uma empresa que chega pelo MyLinksss, com a licença do módulo DisparaZap.
 */
export const USER_TYPES = ['super_admin', 'company_admin', 'mylinksss_admin'] as const;
export type UserType = (typeof USER_TYPES)[number];

export const USER_TYPE_LABELS: Readonly<Record<UserType, string>> = {
  super_admin: 'Super-Admin',
  company_admin: 'Admin-Empresa',
  mylinksss_admin: 'Admin-MyLinksss',
};

// Papéis dentro de uma empresa (ARQUITETURA_SAAS §4.2). Nesta etapa, quem cadastra a empresa é "owner".
export const ORGANIZATION_ROLES = ['owner', 'admin', 'operator', 'viewer'] as const;
export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

export const signupRequestSchema = z.strictObject({
  name: z.string().trim().min(2, 'Informe seu nome.').max(120),
  companyName: z.string().trim().min(2, 'Informe o nome da empresa.').max(120),
  email: z.email('Informe um e-mail válido.').max(254),
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, `A senha precisa ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`)
    .max(PASSWORD_MAX_LENGTH, `A senha pode ter no máximo ${PASSWORD_MAX_LENGTH} caracteres.`),
});
export type SignupRequest = z.infer<typeof signupRequestSchema>;

// Resposta de GET /api/internal/me: só o necessário para o painel. Nunca senha, hash, token ou dados de sessão.
export const sessionInfoSchema = z.strictObject({
  user: z.strictObject({
    id: z.string().min(1),
    name: z.string(),
    email: z.string(),
  }),
  userType: z.enum(USER_TYPES),
  organization: z
    .strictObject({
      id: z.string().min(1),
      name: z.string(),
      role: z.enum(ORGANIZATION_ROLES),
    })
    .nullable(),
});
export type SessionInfo = z.infer<typeof sessionInfoSchema>;
