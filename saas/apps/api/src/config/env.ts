import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { IN_MEMORY, type DatabaseOptions } from '@disparazap/db';
import { logLevelSchema, nodeEnvSchema, parseEnv } from '@disparazap/shared';

// Só "esquema://host[:porta]", exatamente como o navegador envia no cabeçalho Origin. "*" não passa.
function isExactOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === value;
  } catch {
    return false;
  }
}

const originListSchema = z
  .string()
  .default('')
  .transform((raw) => raw.split(',').map((item) => item.trim()).filter(Boolean))
  .pipe(z.array(z.string().refine(isExactOrigin, 'origem inválida: use esquema://host[:porta], sem "*" e sem caminho')));

function isMasterKey(value: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(value) && Buffer.from(value, 'base64url').length === 32;
}

// Texto opcional: vazio vira "não definido"
const optionalText = z
  .string()
  .optional()
  .transform((value) => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
  });

const booleanFlag = (fallback: boolean) =>
  z
    .enum(['true', 'false'], { error: 'use true ou false' })
    .optional()
    .transform((value) => (value === undefined ? fallback : value === 'true'));

/** Endereços internos (proxy na mesma máquina ou na rede privada do provedor), no formato do Fastify/proxy-addr */
export const PRIVATE_PROXY_RANGES = 'loopback,linklocal,uniquelocal';

/**
 * Proxy reverso: false (padrão, sem proxy); true = confia no X-Forwarded-For só quando quem conecta é um endereço
 * interno (loopback ou rede privada); ou a lista exata de IPs/CIDRs do proxy. Quem chega direto pela internet
 * nunca consegue escolher o próprio IP.
 */
const trustProxySchema = z
  .string()
  .trim()
  .optional()
  .transform((value, ctx): false | string => {
    if (!value || value === 'false') return false;
    if (value === 'true') return PRIVATE_PROXY_RANGES;
    const items = value.split(',').map((item) => item.trim()).filter(Boolean);
    const valid = items.length > 0 && items.every((item) => /^[0-9a-fA-F:.]+(\/\d{1,3})?$/.test(item) || ['loopback', 'linklocal', 'uniquelocal'].includes(item));
    if (!valid) {
      ctx.addIssue({ code: 'custom', message: 'use false, true ou a lista de IPs/CIDRs do proxy, separados por vírgula' });
      return z.NEVER;
    }
    return items.join(',');
  });

/** Origem do painel em desenvolvimento (o Vite repassa /api para a API: mesma origem para o navegador) */
export const DEV_PANEL_ORIGIN = 'http://127.0.0.1:3000';

/** Pasta padrão do banco embutido em desenvolvimento: saas/.data/pglite (ignorada pelo git) */
export const DEFAULT_EMBEDDED_DIR = fileURLToPath(new URL('../../../../.data/pglite', import.meta.url));

export const apiEnvSchema = z
  .object({
    NODE_ENV: nodeEnvSchema,
    LOG_LEVEL: logLevelSchema,
    API_HOST: z.string().trim().min(1).default('127.0.0.1'),
    API_PORT: z.coerce.number().int().min(0).max(65535).default(3100),
    API_CORS_ORIGINS: originListSchema,
    API_SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(10_000),
    /** Atrás de um proxy reverso (ex.: Hostinger): de quem aceitar o X-Forwarded-For (veja trustProxySchema) */
    API_TRUST_PROXY: trustProxySchema,
    /** Pasta do painel compilado (apps/web/dist): a API passa a servir o painel na mesma origem. Vazio = só a API */
    WEB_DIST_DIR: optionalText,

    // Banco: PostgreSQL (Supabase) quando DATABASE_URL está preenchido; senão, banco embutido (só fora de produção)
    DATABASE_URL: optionalText.pipe(
      z.url({ protocol: /^postgres(ql)?$/, error: 'use um endereço postgresql://' }).optional(),
    ),
    DATABASE_CA_FILE: optionalText,
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
    DATABASE_EMBEDDED_DIR: optionalText,

    // Autenticação
    AUTH_SECRET: optionalText.pipe(z.string().min(32, 'precisa ter pelo menos 32 caracteres').optional()),
    AUTH_BASE_URL: z
      .string()
      .trim()
      .default(DEV_PANEL_ORIGIN)
      .refine(isExactOrigin, 'use esquema://host[:porta], sem caminho'),
    AUTH_TRUSTED_ORIGINS: originListSchema,
    AUTH_SIGNUP_ENABLED: booleanFlag(true),
    SUPER_ADMIN_EMAIL: optionalText.pipe(z.email('use um e-mail válido').optional()),

    // Inbox (PLANO_MODULO_INBOX, I1). DESLIGADOS por padrão: com eles desligados a API nunca se conecta ao WebSocket da
    // Evolution nem altera instâncias. Só a homologação autorizada (HOMOLOGACAO_I0_EVOLUTION, P2 a P4) os liga.
    /** Receber eventos da Evolution Go por WebSocket (conexão de saída, com a chave global) */
    INBOX_EVENTS_ENABLED: booleanFlag(false),
    /** Permitir o botão "Receber mensagens na Inbox" (POST /instance/connect na instância da empresa) */
    INBOX_ACTIVATION_ENABLED: booleanFlag(false),
    /** Envio de respostas humanas pelo Instagram (Z3.2). Desligado até a migração 0008 e a homologação autorizada */
    INBOX_SOCIAL_SEND_ENABLED: booleanFlag(false),
    /** Criar, alterar, ativar e pausar automações na Zernio (PLANO_MODULO_AUTOMACOES, decisão A5). Desligado até a homologação */
    AUTOMATIONS_WRITE_ENABLED: booleanFlag(false),

    // Chave-mestra do cofre de credenciais (AES-256-GCM): 32 bytes em base64url, só no saas/.env
    SECRETS_MASTER_KEY: optionalText.pipe(
      z.string().refine(isMasterKey, 'use 32 bytes aleatórios em base64url (veja o comando no .env.example)').optional(),
    ),
  })
  .superRefine((config, ctx) => {
    if (config.DATABASE_URL && !config.DATABASE_CA_FILE) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_CA_FILE'],
        message: 'obrigatório quando DATABASE_URL está preenchido (a verificação TLS não pode ser desligada)',
      });
    }
    if (config.NODE_ENV === 'production') {
      if (!config.DATABASE_URL) ctx.addIssue({ code: 'custom', path: ['DATABASE_URL'], message: 'obrigatório em produção' });
      if (!config.AUTH_SECRET) ctx.addIssue({ code: 'custom', path: ['AUTH_SECRET'], message: 'obrigatório em produção' });
      if (!config.SECRETS_MASTER_KEY) ctx.addIssue({ code: 'custom', path: ['SECRETS_MASTER_KEY'], message: 'obrigatório em produção' });
      if (!config.AUTH_BASE_URL.startsWith('https://')) {
        ctx.addIssue({ code: 'custom', path: ['AUTH_BASE_URL'], message: 'precisa usar https em produção' });
      }
    }
  });

export type ApiConfig = z.output<typeof apiEnvSchema>;

export function loadApiConfig(source: Record<string, string | undefined> = process.env): ApiConfig {
  return parseEnv(apiEnvSchema, source);
}

/**
 * Origens confiáveis para pedidos com cookie (Better Auth e rotas do painel).
 * Fora de produção, "localhost" equivale a "127.0.0.1" na mesma porta (auditoria A4: abrir o painel por localhost bloqueava o login).
 */
export function trustedOrigins(config: ApiConfig): string[] {
  const list = new Set([config.AUTH_BASE_URL, ...config.AUTH_TRUSTED_ORIGINS]);
  if (config.NODE_ENV !== 'production') {
    const base = new URL(config.AUTH_BASE_URL);
    if (base.hostname === '127.0.0.1') list.add(`${base.protocol}//localhost${base.port ? `:${base.port}` : ''}`);
    // Painel de desenvolvimento (porta 3000) aceito mesmo que o .env ainda aponte para outro endereço
    list.add(DEV_PANEL_ORIGIN);
    list.add(DEV_PANEL_ORIGIN.replace('127.0.0.1', 'localhost'));
  }
  return [...list];
}

/** Como abrir o banco a partir da configuração */
export function databaseOptions(config: ApiConfig): DatabaseOptions {
  if (config.DATABASE_URL && config.DATABASE_CA_FILE) {
    return {
      kind: 'postgres',
      url: config.DATABASE_URL,
      caFile: config.DATABASE_CA_FILE,
      poolMax: config.DATABASE_POOL_MAX,
      applicationName: 'disparazap-api',
    };
  }
  const dataDir = config.DATABASE_EMBEDDED_DIR ?? (config.NODE_ENV === 'test' ? IN_MEMORY : DEFAULT_EMBEDDED_DIR);
  return { kind: 'embedded', dataDir };
}
