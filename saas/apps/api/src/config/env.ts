import { z } from 'zod';
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
  .pipe(z.array(z.string().refine(isExactOrigin, 'origem CORS inválida: use esquema://host[:porta], sem "*" e sem caminho')));

export const apiEnvSchema = z.object({
  NODE_ENV: nodeEnvSchema,
  LOG_LEVEL: logLevelSchema,
  API_HOST: z.string().trim().min(1).default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(0).max(65535).default(3100),
  API_CORS_ORIGINS: originListSchema,
  API_SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(10_000),
});

export type ApiConfig = z.output<typeof apiEnvSchema>;

export function loadApiConfig(source: Record<string, string | undefined> = process.env): ApiConfig {
  return parseEnv(apiEnvSchema, source);
}
