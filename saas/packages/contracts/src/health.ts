import { z } from 'zod';

// Resposta de GET /health/live: só diz que o processo responde. Sem versão, host, uptime ou configuração.
export const healthLiveSchema = z.strictObject({
  status: z.literal('ok'),
  service: z.string().min(1),
  timestamp: z.iso.datetime(),
});

export type HealthLive = z.infer<typeof healthLiveSchema>;

// Resposta de GET /health/ready: o processo responde e o banco também. Não revela qual banco nem onde está.
export const healthReadySchema = z.strictObject({
  status: z.enum(['ok', 'unavailable']),
  database: z.enum(['ok', 'unavailable']),
  timestamp: z.iso.datetime(),
});

export type HealthReady = z.infer<typeof healthReadySchema>;
