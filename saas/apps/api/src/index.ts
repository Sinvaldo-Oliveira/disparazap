import { EMBEDDED_LOCKED_CODE } from '@disparazap/db';
import { ConfigError, createLogger, handleShutdownSignals } from '@disparazap/shared';
import { buildApp } from './app/build-app.ts';
import { databaseOptions, loadApiConfig, type ApiConfig } from './config/env.ts';
import { createServices } from './services.ts';

function readConfig(): ApiConfig {
  try {
    return loadApiConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`✖ API: ${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }
}

const config = readConfig();
const authLogger = createLogger('disparazap-auth', config.LOG_LEVEL);

let services;
try {
  services = await createServices(config, (level, message) => authLogger[level]({ origem: 'better-auth' }, message));
} catch (err) {
  // Sem a mensagem do erro: a do driver pode conter o endereço do banco. Só o código (ex.: ENOENT, ECONNREFUSED).
  const code = (err as { code?: unknown }).code;
  const reason = typeof code === 'string' && /^[A-Z0-9_]+$/.test(code) ? ` (código ${code})` : '';
  if (code === EMBEDDED_LOCKED_CODE) {
    // Duas APIs no mesmo banco embutido o corrompem: esta não abre e não toca em nada
    process.stderr.write('✖ API: outra API já está usando o banco embutido (saas/.data). Feche a outra janela com "npm run dev:api" antes de abrir esta.\n');
    process.exit(1);
  }
  const hint =
    databaseOptions(config).kind === 'embedded'
      ? 'banco embutido de desenvolvimento. Confira DATABASE_EMBEDDED_DIR no saas/.env (vazio = saas/.data/pglite) e se outro processo já está usando a pasta'
      : 'PostgreSQL. Confira DATABASE_URL e DATABASE_CA_FILE no saas/.env';
  process.stderr.write(`✖ API: não foi possível abrir o ${hint}${reason}.\n`);
  process.exit(1);
}

let app;
try {
  app = await buildApp(config, { services });
} catch (err) {
  if (err instanceof ConfigError) {
    process.stderr.write(`✖ API: ${err.message}\n`);
    await services.database.close();
    process.exit(1);
  }
  throw err;
}

app.log.info({ banco: services.database.kind === 'embedded' ? 'embutido (desenvolvimento)' : 'PostgreSQL', painel: config.WEB_DIST_DIR ? 'servido pela API' : 'não' }, 'banco de dados aberto');
if (services.ephemeralSecret) {
  app.log.warn('AUTH_SECRET não configurado: usando um segredo temporário; as sessões não sobrevivem a um reinício da API');
}

handleShutdownSignals({
  logger: app.log,
  onShutdown: async () => {
    await app.close();
    await services.database.close();
  },
  timeoutMs: config.API_SHUTDOWN_TIMEOUT_MS,
});

try {
  await app.listen({ host: config.API_HOST, port: config.API_PORT });
} catch (err) {
  app.log.error({ err }, 'não foi possível iniciar a API');
  await services.database.close();
  process.exit(1);
}
