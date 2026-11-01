import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigError, createLogger, handleShutdownSignals, type SignalSource } from '@disparazap/shared';
import { loadWorkerConfig } from './config/env.ts';
import { queues } from './queues/index.ts';
import { createWorker } from './worker.ts';

function captureLogger(level = 'info') {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(String(chunk));
      callback();
    },
  });
  return { lines, logger: createLogger('disparazap-worker', level, stream) };
}

describe('configuração do worker', () => {
  it('usa padrões e recusa valores fora da faixa sem ecoá-los', () => {
    expect(loadWorkerConfig({})).toMatchObject({ WORKER_HEARTBEAT_MS: 30_000, WORKER_SHUTDOWN_TIMEOUT_MS: 10_000 });
    expect(() => loadWorkerConfig({ WORKER_HEARTBEAT_MS: '10' })).toThrow(ConfigError);
    expect(() => loadWorkerConfig({ WORKER_HEARTBEAT_MS: 'valor-xyz' })).toThrow(/WORKER_HEARTBEAT_MS/);
  });

  it('nenhuma fila está registrada na Fase 4', () => {
    expect(queues).toEqual([]);
  });
});

describe('ciclo de vida do worker', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('inicia, mantém só o sinal de vida e encerra sem deixar timers ativos', async () => {
    vi.useFakeTimers();
    const { lines, logger } = captureLogger('debug');
    const worker = createWorker({ config: loadWorkerConfig({ WORKER_HEARTBEAT_MS: '1000' }), logger, queues });
    expect(worker.state).toBe('idle');

    worker.start();
    expect(worker.state).toBe('running');
    vi.advanceTimersByTime(2500);
    expect(lines.filter((line) => line.includes('worker ativo'))).toHaveLength(2);

    await worker.stop();
    expect(worker.state).toBe('stopped');
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(5000);
    expect(lines.filter((line) => line.includes('worker ativo'))).toHaveLength(2);
    expect(lines.join('')).toContain('worker encerrado');
  });

  it('não inicia duas vezes e encerrar de novo é inofensivo', async () => {
    const { logger } = captureLogger();
    const worker = createWorker({ config: loadWorkerConfig({}), logger, queues });
    worker.start();
    expect(() => worker.start()).toThrow(/não pode iniciar/);
    await worker.stop();
    await worker.stop();
    expect(worker.state).toBe('stopped');
  });

  it('sinal de encerramento para o worker e sai com 0', async () => {
    const { logger } = captureLogger();
    const worker = createWorker({ config: loadWorkerConfig({}), logger, queues });
    const emitter = new EventEmitter();
    const exit = vi.fn<(code: number) => void>();
    const source: SignalSource = {
      on: (event, listener) => emitter.on(event, listener),
      off: (event, listener) => emitter.off(event, listener),
      exit,
    };
    handleShutdownSignals({ logger, onShutdown: () => worker.stop(), source });
    worker.start();
    emitter.emit('SIGTERM', 'SIGTERM');
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    expect(worker.state).toBe('stopped');
  });
});

describe('processo do worker', () => {
  // Subir um processo Node real pode levar alguns segundos sob carga; o padrão de 5 s do Vitest é curto.
  // Fica acima da espera interna de 15 s, para que ela termine primeiro com uma mensagem clara.
  const PROCESS_TEST_TIMEOUT_MS = 30_000;
  const children: ChildProcess[] = [];
  afterEach(() => {
    for (const child of children.splice(0)) child.kill();
  });

  it('inicia de forma independente e continua ativo', { timeout: PROCESS_TEST_TIMEOUT_MS }, async () => {
    const entry = fileURLToPath(new URL('./index.ts', import.meta.url));
    const child = spawn(process.execPath, ['--conditions=source', entry], {
      env: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', LOG_LEVEL: 'info' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.push(child);
    let output = '';
    child.stdout?.on('data', (d) => { output += d; });
    child.stderr?.on('data', (d) => { output += d; });
    await expect.poll(() => output, { timeout: 15_000 }).toContain('worker iniciado');
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(child.exitCode).toBeNull();
  });
});
