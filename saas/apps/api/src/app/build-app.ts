import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import type { DestinationStream } from 'pino';
import { API_V1_PREFIX, INTERNAL_API_PREFIX, PLATFORM_API_PREFIX, WHATSAPP_API_PREFIX } from '@disparazap/contracts';
import { trustedOrigins as resolveTrustedOrigins, type ApiConfig } from '../config/env.ts';
import { createEvolutionProvider } from '../integrations/whatsapp-provider.ts';
import { registerErrorHandling } from '../plugins/error-handler.ts';
import { apiLoggerOptions } from '../plugins/logger.ts';
import { registerCors, registerSecurityHeaders } from '../plugins/security.ts';
import { authRoutes } from '../routes/auth.ts';
import { healthRoutes, readyRoutes } from '../routes/health.ts';
import { internalRoutes } from '../routes/internal.ts';
import { messagingRoutes } from '../routes/messaging.ts';
import { platformRoutes } from '../routes/platform.ts';
import { v1Routes } from '../routes/v1.ts';
import { whatsappRoutes } from '../routes/whatsapp.ts';
import type { ConnectionChecker } from '../platform/evolution-settings.ts';
import type { ApiServices } from '../services.ts';
import type { ProviderFactory, WhatsAppContext } from '../whatsapp/whatsapp-service.ts';

export interface BuildAppOptions {
  /** Destino dos logs (testes capturam aqui). Padrão: saída padrão. */
  logStream?: DestinationStream;
  /** Banco, autenticação e cofre. Sem eles, a API sobe só com os health checks (testes de infraestrutura). */
  services?: Pick<ApiServices, 'auth' | 'database' | 'vault'>;
  /** Teste de conexão com a Evolution Go (os testes usam um simulador) */
  checkEvolutionConnection?: ConnectionChecker;
  /** Adaptador da Evolution Go para o módulo WhatsApp (padrão: o real, apontando para o servidor configurado) */
  whatsappProviderFactory?: ProviderFactory;
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

  const services = options.services;
  if (services) {
    await app.register(readyRoutes, { pingDatabase: () => services.database.ping() });
    await app.register(authRoutes, { auth: services.auth, baseUrl: config.AUTH_BASE_URL });
    const trustedOrigins = resolveTrustedOrigins(config);
    const whatsapp: WhatsAppContext = {
      db: services.database.db,
      vault: services.vault,
      providerFactory: options.whatsappProviderFactory ?? createEvolutionProvider,
    };
    await app.register(internalRoutes, {
      prefix: INTERNAL_API_PREFIX,
      auth: services.auth,
      db: services.database.db,
      signupEnabled: config.AUTH_SIGNUP_ENABLED,
      reservedEmail: config.SUPER_ADMIN_EMAIL,
      trustedOrigins,
    });
    await app.register(platformRoutes, {
      prefix: PLATFORM_API_PREFIX,
      auth: services.auth,
      db: services.database.db,
      vault: services.vault,
      trustedOrigins,
      whatsapp,
      ...(options.checkEvolutionConnection ? { checkConnection: options.checkEvolutionConnection } : {}),
    });
    await app.register(whatsappRoutes, { prefix: WHATSAPP_API_PREFIX, auth: services.auth, context: whatsapp, trustedOrigins });
    await app.register(messagingRoutes, { prefix: INTERNAL_API_PREFIX, auth: services.auth, context: whatsapp, trustedOrigins });
  }

  return app;
}
