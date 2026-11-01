import { z } from 'zod';

// Resposta de GET /health/live: só diz que o processo responde. Sem versão, host, uptime ou configuração.
export const healthLiveSchema = z.strictObject({
  status: z.literal('ok'),
  service: z.string().min(1),
  timestamp: z.iso.datetime(),
});

export type HealthLive = z.infer<typeof healthLiveSchema>;
