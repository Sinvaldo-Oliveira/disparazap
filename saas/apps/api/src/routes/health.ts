import type { FastifyPluginAsync } from 'fastify';
import { HEALTH_LIVE_PATH, type HealthLive } from '@disparazap/contracts';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  // logLevel "warn": sondas de saúde a cada poucos segundos não poluem o log
  app.get(HEALTH_LIVE_PATH, { logLevel: 'warn' }, async (): Promise<HealthLive> => ({
    status: 'ok',
    service: 'disparazap-api',
    timestamp: new Date().toISOString(),
  }));
};
