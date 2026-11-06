import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import type { DestinationStream } from 'pino';
import { API_V1_PREFIX, AUTOMATIONS_PATH, INBOX_PATH, INTERNAL_API_PREFIX, PLATFORM_API_PREFIX, SOCIAL_PATH, WHATSAPP_API_PREFIX, ZERNIO_PATH } from '@disparazap/contracts';
import { trustedOrigins as resolveTrustedOrigins, type ApiConfig } from '../config/env.ts';
import { EvolutionEventStream, type EvolutionEventStreamOptions } from '../inbox/evolution-events.ts';
import { InboxBus } from '../inbox/inbox-bus.ts';
import type { InboxContext } from '../inbox/inbox-service.ts';
import { createEvolutionProvider } from '../integrations/whatsapp-provider.ts';
import { createZernioClient, type ZernioClientFactory } from '../integrations/zernio-client.ts';
import { registerErrorHandling } from '../plugins/error-handler.ts';
import { apiLoggerOptions } from '../plugins/logger.ts';
import { registerCors, registerSecurityHeaders } from '../plugins/security.ts';
import { loadPanelFiles, panelFallback } from '../plugins/web-panel.ts';
import { authRoutes } from '../routes/auth.ts';
import { healthRoutes, readyRoutes } from '../routes/health.ts';
import { inboxRoutes } from '../routes/inbox.ts';
import { internalRoutes } from '../routes/internal.ts';
import { messagingRoutes } from '../routes/messaging.ts';
import { platformRoutes } from '../routes/platform.ts';
import { socialRoutes } from '../routes/social.ts';
import { automationsRoutes } from '../routes/automations.ts';
import { v1Routes } from '../routes/v1.ts';
import { whatsappRoutes } from '../routes/whatsapp.ts';
import { zernioRoutes } from '../routes/zernio.ts';
import type { ConnectionChecker } from '../platform/evolution-settings.ts';
import type { ApiServices } from '../services.ts';
import type { ProviderFactory, WhatsAppContext } from '../whatsapp/whatsapp-service.ts';
import type { ZernioContext } from '../zernio/zernio-service.ts';

export interface BuildAppOptions {
  /** Destino dos logs (testes capturam aqui). Padrão: saída padrão. */
  logStream?: DestinationStream;
  /** Banco, autenticação e cofre. Sem eles, a API sobe só com os health checks (testes de infraestrutura). */
  services?: Pick<ApiServices, 'auth' | 'database' | 'vault'>;
  /** Teste de conexão com a Evolution Go (os testes usam um simulador) */
  checkEvolutionConnection?: ConnectionChecker;
  /** Adaptador da Evolution Go para o módulo WhatsApp (padrão: o real, apontando para o servidor configurado) */
  whatsappProviderFactory?: ProviderFactory;
  /** Cliente da Zernio a partir da chave de cada empresa (padrão: o real, endereço fixo; os testes usam a Zernio simulada) */
  zernioClientFactory?: ZernioClientFactory;
  /** Ajustes do consumidor de eventos da Inbox e do canal em tempo real (os testes encurtam as esperas) */
  inbox?: {
    stream?: Partial<Pick<EvolutionEventStreamOptions, 'reconnectMinMs' | 'reconnectMaxMs' | 'refreshMs' | 'ws'>>;
    streamHeartbeatMs?: number;
    streamMaxAgeMs?: number;
    /** Os testes recebem o consumidor para esperar o processamento dos eventos */
    onStream?: (stream: EvolutionEventStream) => void;
  };
}

// Monta a aplicação sem abrir porta: os testes usam `inject`, o index.ts chama `listen`
export async function buildApp(config: ApiConfig, options: BuildAppOptions = {}): Promise<FastifyInstance> {
  // Painel compilado na mesma origem (só quando WEB_DIST_DIR está preenchido; lido antes de abrir a porta)
  const panel = config.WEB_DIST_DIR ? loadPanelFiles(config.WEB_DIST_DIR) : null;
  const app = Fastify({
    logger: apiLoggerOptions(config.LOG_LEVEL, options.logStream),
    genReqId: () => randomUUID(),
    requestIdHeader: false,
    // Só atrás de proxy reverso, e só quando quem conecta é o proxy (endereço interno ou lista configurada):
    // o X-Forwarded-For enviado por um visitante que chega direto não vale
    trustProxy: config.API_TRUST_PROXY,
    bodyLimit: 1024 * 1024,
    return503OnClosing: true,
  });

  registerSecurityHeaders(app, { hsts: config.NODE_ENV === 'production' });
  registerErrorHandling(app, panel ? panelFallback(panel) : undefined);
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
    const zernio: ZernioContext = {
      db: services.database.db,
      vault: services.vault,
      clientFactory: options.zernioClientFactory ?? ((apiKey) => createZernioClient(apiKey)),
      // A Zernio devolve a pessoa para o painel (mesma origem do login)
      panelOrigin: config.AUTH_BASE_URL,
    };
    await app.register(zernioRoutes, { prefix: ZERNIO_PATH, auth: services.auth, trustedOrigins, context: zernio });
    // Redes Sociais: publicar, agendar e acompanhar pela mesma conta Zernio da empresa
    await app.register(socialRoutes, { prefix: SOCIAL_PATH, auth: services.auth, trustedOrigins, context: zernio });
    // Automações de redes (PLANO_MODULO_AUTOMACOES): a Zernio guarda as automações; criar e ativar dependem da trava
    await app.register(automationsRoutes, { prefix: AUTOMATIONS_PATH, auth: services.auth, trustedOrigins, context: zernio, writeEnabled: config.AUTOMATIONS_WRITE_ENABLED });

    // Inbox: o consumidor dos eventos da Evolution só existe com INBOX_EVENTS_ENABLED (desligado por padrão, até a
    // homologação P0–P7); sem ele, a Inbox mostra o recebimento como desligado e o envio de respostas segue funcionando
    const bus = new InboxBus();
    const stream = config.INBOX_EVENTS_ENABLED
      ? new EvolutionEventStream({ db: services.database.db, vault: services.vault, bus, logger: app.log.child({ modulo: 'inbox' }), ...options.inbox?.stream })
      : null;
    const inbox: InboxContext = { db: services.database.db, whatsapp, bus, stream, activationEnabled: config.INBOX_ACTIVATION_ENABLED };
    await app.register(inboxRoutes, {
      prefix: INBOX_PATH,
      auth: services.auth,
      trustedOrigins,
      context: inbox,
      zernio,
      socialSendEnabled: config.INBOX_SOCIAL_SEND_ENABLED,
      ...(options.inbox?.streamHeartbeatMs ? { streamHeartbeatMs: options.inbox.streamHeartbeatMs } : {}),
      ...(options.inbox?.streamMaxAgeMs ? { streamMaxAgeMs: options.inbox.streamMaxAgeMs } : {}),
    });
    if (stream) {
      options.inbox?.onStream?.(stream);
      app.addHook('onReady', async () => stream.start());
      app.addHook('preClose', async () => stream.stop());
    }
  }

  return app;
}
