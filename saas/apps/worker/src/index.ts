import { ConfigError, createLogger, handleShutdownSignals } from '@disparazap/shared';
import { loadWorkerConfig, type WorkerConfig } from './config/env.ts';
import { queues } from './queues/index.ts';
import { createWorker } from './worker.ts';

function readConfig(): WorkerConfig {
  try {
    return loadWorkerConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`✖ Worker: ${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }
}

const config = readConfig();
const logger = createLogger('disparazap-worker', config.LOG_LEVEL);
const worker = createWorker({ config, logger, queues });

handleShutdownSignals({
  logger,
  onShutdown: () => worker.stop(),
  timeoutMs: config.WORKER_SHUTDOWN_TIMEOUT_MS,
});

worker.start();
