import { z } from 'zod';

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

// Erros no formato RFC 9457. Nunca carrega stack trace, mensagem interna ou dado recebido.
export const problemDetailsSchema = z.strictObject({
  type: z.string(),
  title: z.string().min(1),
  status: z.number().int().min(400).max(599),
  detail: z.string().optional(),
  instance: z.string().optional(),
  requestId: z.string().min(1),
});

export type ProblemDetails = z.infer<typeof problemDetailsSchema>;
