import type { Logger } from 'pino';
import type { WorkerConfig } from './config/env.ts';
import type { QueueDefinition } from './queues/index.ts';

export type WorkerState = 'idle' | 'running' | 'stopping' | 'stopped';

export interface Worker {
  readonly state: WorkerState;
  start(): void;
  stop(): Promise<void>;
}

interface WorkerDeps {
  config: WorkerConfig;
  logger: Logger;
  queues: readonly QueueDefinition[];
}

export function createWorker({ config, logger, queues }: WorkerDeps): Worker {
  let state: WorkerState = 'idle';
  let heartbeat: NodeJS.Timeout | undefined;

  return {
    get state() {
      return state;
    },

    start() {
      if (state !== 'idle') throw new Error(`o worker não pode iniciar no estado "${state}"`);
      state = 'running';
      logger.info({ queues: queues.map((queue) => queue.name) }, 'worker iniciado — nenhuma fila configurada nesta fase');
      // Só mantém o processo vivo e registra sinal de vida (nível debug). Não executa tarefas.
      heartbeat = setInterval(() => logger.debug('worker ativo'), config.WORKER_HEARTBEAT_MS);
    },

    async stop() {
      if (state === 'stopping' || state === 'stopped') return;
      state = 'stopping';
      clearInterval(heartbeat);
      heartbeat = undefined;
      // Futuro: parar de consumir filas e aguardar os jobs em andamento antes de sair
      state = 'stopped';
      logger.info({}, 'worker encerrado');
    },
  };
}
