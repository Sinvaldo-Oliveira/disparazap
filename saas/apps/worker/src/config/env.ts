import { z } from 'zod';
import { logLevelSchema, nodeEnvSchema, parseEnv } from '@disparazap/shared';

export const workerEnvSchema = z.object({
  NODE_ENV: nodeEnvSchema,
  LOG_LEVEL: logLevelSchema,
  WORKER_HEARTBEAT_MS: z.coerce.number().int().min(1000).max(300_000).default(30_000),
  WORKER_SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(10_000),
});

export type WorkerConfig = z.output<typeof workerEnvSchema>;

export function loadWorkerConfig(source: Record<string, string | undefined> = process.env): WorkerConfig {
  return parseEnv(workerEnvSchema, source);
}
