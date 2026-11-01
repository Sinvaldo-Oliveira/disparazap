export interface ShutdownLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

// Subconjunto de `process` usado aqui — permite testar sem enviar sinais de verdade
export interface SignalSource {
  on(event: NodeJS.Signals, listener: (signal: NodeJS.Signals) => void): unknown;
  off(event: NodeJS.Signals, listener: (signal: NodeJS.Signals) => void): unknown;
  exit(code: number): void;
}

export interface ShutdownOptions {
  logger: ShutdownLogger;
  onShutdown: () => Promise<void>;
  timeoutMs?: number;
  signals?: readonly NodeJS.Signals[];
  source?: SignalSource;
}

/**
 * Encerramento controlado: no primeiro sinal chama `onShutdown` e sai com 0.
 * Falha, prazo esgotado ou segundo sinal saem com 1. Retorna uma função que remove os ouvintes.
 * No Windows, só o Ctrl+C (SIGINT) chega ao processo; SIGTERM vem do Docker/Linux.
 */
export function handleShutdownSignals({
  logger,
  onShutdown,
  timeoutMs = 10_000,
  signals = ['SIGINT', 'SIGTERM'],
  source = process,
}: ShutdownOptions): () => void {
  let shuttingDown = false;

  const listener = (signal: NodeJS.Signals): void => {
    if (shuttingDown) {
      logger.warn({ signal }, 'segundo sinal recebido: encerrando imediatamente');
      source.exit(1);
      return;
    }
    shuttingDown = true;
    logger.info({ signal }, 'encerrando');

    const timer = setTimeout(() => {
      logger.error({ timeoutMs }, 'prazo de encerramento esgotado');
      source.exit(1);
    }, timeoutMs);
    timer.unref();

    onShutdown().then(
      () => {
        clearTimeout(timer);
        logger.info({}, 'encerrado');
        source.exit(0);
      },
      (err: unknown) => {
        clearTimeout(timer);
        logger.error({ err }, 'falha ao encerrar');
        source.exit(1);
      },
    );
  };

  for (const signal of signals) source.on(signal, listener);
  return () => {
    for (const signal of signals) source.off(signal, listener);
  };
}
