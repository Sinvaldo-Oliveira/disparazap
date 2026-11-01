import { z } from 'zod';

export const nodeEnvSchema = z.enum(['development', 'test', 'production']).default('development');

export const logLevelSchema = z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info');

export class ConfigError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Configuração inválida — ${issues.join('; ')}`);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

/**
 * Valida variáveis de ambiente com um schema Zod.
 * A mensagem de erro cita só o nome da variável e o problema — nunca o valor recebido, que pode ser um segredo.
 */
export function parseEnv<T extends z.ZodType>(schema: T, source: Record<string, string | undefined>): z.output<T> {
  const result = schema.safeParse(source);
  if (result.success) return result.data;
  throw new ConfigError(result.error.issues.map((issue) => `${issue.path.join('.') || '(raiz)'}: ${issue.message}`));
}
