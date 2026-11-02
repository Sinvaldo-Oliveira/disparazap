import type { FastifyPluginAsync } from 'fastify';
import { HEALTH_LIVE_PATH, HEALTH_READY_PATH, type HealthLive, type HealthReady } from '@disparazap/contracts';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  // logLevel "warn": sondas de saúde a cada poucos segundos não poluem o log
  app.get(HEALTH_LIVE_PATH, { logLevel: 'warn' }, async (): Promise<HealthLive> => ({
    status: 'ok',
    service: 'disparazap-api',
    timestamp: new Date().toISOString(),
  }));
};

export interface ReadyRoutesOptions {
  /** Consulta mínima ao banco */
  pingDatabase: () => Promise<boolean>;
}

/** Pronto para atender: o banco responde. Não diz qual banco nem onde está. */
export const readyRoutes: FastifyPluginAsync<ReadyRoutesOptions> = async (app, { pingDatabase }) => {
  app.get(HEALTH_READY_PATH, { logLevel: 'warn' }, async (_request, reply): Promise<HealthReady> => {
    const ok = await pingDatabase();
    reply.status(ok ? 200 : 503);
    return { status: ok ? 'ok' : 'unavailable', database: ok ? 'ok' : 'unavailable', timestamp: new Date().toISOString() };
  });
};
