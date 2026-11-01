import { ConfigError, handleShutdownSignals } from '@disparazap/shared';
import { buildApp } from './app/build-app.ts';
import { loadApiConfig, type ApiConfig } from './config/env.ts';

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
const app = await buildApp(config);

handleShutdownSignals({
  logger: app.log,
  onShutdown: () => app.close(),
  timeoutMs: config.API_SHUTDOWN_TIMEOUT_MS,
});

try {
  await app.listen({ host: config.API_HOST, port: config.API_PORT });
} catch (err) {
  app.log.error({ err }, 'não foi possível iniciar a API');
  process.exit(1);
}
