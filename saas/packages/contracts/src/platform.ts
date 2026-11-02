import { z } from 'zod';
import { INTERNAL_API_PREFIX } from './auth.ts';

// Configurações de plataforma: só o Super-Admin acessa
export const PLATFORM_API_PREFIX = `${INTERNAL_API_PREFIX}/platform`;
export const EVOLUTION_SETTINGS_PATH = `${PLATFORM_API_PREFIX}/evolution`;
export const EVOLUTION_TEST_PATH = `${EVOLUTION_SETTINGS_PATH}/test`;

/** Nome do servidor Evolution Go principal (o modelo já admite vários, como prevê a arquitetura) */
export const EVOLUTION_PRIMARY_SERVER_NAME = 'Servidor principal';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

// URL existe no navegador e no Node; o pacote não depende dos tipos de nenhum dos dois ambientes
interface ParsedUrl {
  protocol: string;
  username: string;
  password: string;
  search: string;
  hash: string;
  hostname: string;
  origin: string;
  pathname: string;
}
const parseUrl = (value: string): ParsedUrl => new (globalThis as unknown as { URL: new (input: string) => ParsedUrl }).URL(value);

/**
 * Endereço base aceito para a Evolution Go:
 * - http ou https, sem usuário/senha, sem parâmetros e sem âncora;
 * - http só para esta máquina ou para um nome interno sem ponto (ex.: serviço do Docker "evolution-go"),
 *   porque a chave global viaja no cabeçalho de cada pedido.
 * Devolve o motivo da recusa, ou null se o endereço for aceito.
 */
export function evolutionUrlProblem(value: string): string | null {
  let url: ParsedUrl;
  try {
    url = parseUrl(value.trim());
  } catch {
    return 'Informe um endereço completo, por exemplo https://evolution.suaempresa.com.br';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'Use um endereço http:// ou https://.';
  if (url.username || url.password) return 'O endereço não pode conter usuário ou senha.';
  if (url.search || url.hash) return 'O endereço não pode conter parâmetros (?…) nem âncora (#…).';
  const internal = LOCAL_HOSTS.has(url.hostname) || !url.hostname.includes('.');
  if (url.protocol === 'http:' && !internal) return 'Use https://: a chave global não pode trafegar sem criptografia.';
  return null;
}

/** Endereço sem barra no final (o MVP usa a mesma convenção para EVOLUTION_URL) */
export function normalizeEvolutionUrl(value: string): string {
  const url = parseUrl(value.trim());
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

export const SERVER_STATUSES = ['active', 'disabled'] as const;
export const CONNECTION_CHECK_STATUSES = ['ok', 'unauthorized', 'unreachable', 'invalid_response', 'error'] as const;
export type ConnectionCheckStatus = (typeof CONNECTION_CHECK_STATUSES)[number];

export const evolutionSettingsInputSchema = z.strictObject({
  name: z.string().trim().min(2, 'Dê um nome ao servidor.').max(80),
  baseUrl: z
    .string()
    .trim()
    .max(300)
    .superRefine((value, ctx) => {
      const problem = evolutionUrlProblem(value);
      if (problem) ctx.addIssue({ code: 'custom', message: problem });
    }),
  status: z.enum(SERVER_STATUSES),
  // Vazio ou ausente = manter a chave já guardada
  apiKey: z.string().trim().max(512).optional(),
});
export type EvolutionSettingsInput = z.infer<typeof evolutionSettingsInputSchema>;

// O que a API devolve: nunca a chave, só se existe e os 4 últimos caracteres
export const evolutionSettingsSchema = z.strictObject({
  server: z
    .strictObject({
      name: z.string(),
      baseUrl: z.string(),
      status: z.enum(SERVER_STATUSES),
      apiKey: z.strictObject({ configured: z.boolean(), last4: z.string().nullable() }),
      lastCheck: z.strictObject({
        at: z.iso.datetime().nullable(),
        status: z.enum(CONNECTION_CHECK_STATUSES).nullable(),
        detail: z.string().nullable(),
      }),
      updatedAt: z.iso.datetime(),
    })
    .nullable(),
  /** false quando falta a chave-mestra do cofre no servidor (SECRETS_MASTER_KEY) */
  vaultReady: z.boolean(),
});
export type EvolutionSettings = z.infer<typeof evolutionSettingsSchema>;

export const evolutionTestResultSchema = z.strictObject({
  status: z.enum(CONNECTION_CHECK_STATUSES),
  detail: z.string(),
  instances: z.number().int().nonnegative().nullable(),
  at: z.iso.datetime(),
});
export type EvolutionTestResult = z.infer<typeof evolutionTestResultSchema>;
