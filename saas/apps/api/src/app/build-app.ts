import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import type { DestinationStream } from 'pino';
import { API_V1_PREFIX } from '@disparazap/contracts';
import type { ApiConfig } from '../config/env.ts';
import { registerErrorHandling } from '../plugins/error-handler.ts';
import { apiLoggerOptions } from '../plugins/logger.ts';
import { registerCors, registerSecurityHeaders } from '../plugins/security.ts';
import { healthRoutes } from '../routes/health.ts';
import { v1Routes } from '../routes/v1.ts';

export interface BuildAppOptions {
  /** Destino dos logs (testes capturam aqui). Padrão: saída padrão. */
  logStream?: DestinationStream;
}

// Monta a aplicação sem abrir porta: os testes usam `inject`, o index.ts chama `listen`
export async function buildApp(config: ApiConfig, options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: apiLoggerOptions(config.LOG_LEVEL, options.logStream),
    genReqId: () => randomUUID(),
    requestIdHeader: false,
    trustProxy: false,
    bodyLimit: 1024 * 1024,
    return503OnClosing: true,
  });

  registerSecurityHeaders(app);
  registerErrorHandling(app);
  await registerCors(app, config.API_CORS_ORIGINS);

  await app.register(healthRoutes);
  await app.register(v1Routes, { prefix: API_V1_PREFIX });

  return app;
}
