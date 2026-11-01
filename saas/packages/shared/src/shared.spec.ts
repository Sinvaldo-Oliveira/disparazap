import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ConfigError, createLogger, handleShutdownSignals, parseEnv, type SignalSource } from './index.ts';

describe('parseEnv', () => {
  const schema = z.object({ PORTA: z.coerce.number().int().min(1), MODO: z.enum(['a', 'b']).default('a') });

  it('aplica padrões e converte tipos', () => {
    expect(parseEnv(schema, { PORTA: '3100' })).toEqual({ PORTA: 3100, MODO: 'a' });
  });

  it('lista as variáveis inválidas sem repetir o valor recebido', () => {
    const segredo = 'valor-secreto-nao-pode-aparecer';
    let error: unknown;
    try {
      parseEnv(schema, { PORTA: segredo, MODO: segredo });
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(ConfigError);
    const configError = error as ConfigError;
    expect(configError.issues.map((issue) => issue.split(':')[0])).toEqual(['PORTA', 'MODO']);
    expect(configError.message).not.toContain(segredo);
  });
});

describe('createLogger', () => {
  function capture() {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(String(chunk));
        callback();
      },
    });
    return { lines, stream };
  }

  it('remove credenciais no primeiro e no segundo nível', () => {
    const { lines, stream } = capture();
    const logger = createLogger('teste', 'info', stream);
    logger.info({ token: 'tk-1', password: 'pw-1', auth: { apiKey: 'ak-1', secret: 'sc-1' }, visivel: 'ok' }, 'evento');
    const out = lines.join('');
    for (const valor of ['tk-1', 'pw-1', 'ak-1', 'sc-1']) expect(out).not.toContain(valor);
    expect(out).toContain('[REDACTED]');
    expect(out).toContain('"visivel":"ok"');
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({ service: 'teste', msg: 'evento' });
  });
});

describe('handleShutdownSignals', () => {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

  function fakeProcess() {
    const emitter = new EventEmitter();
    const exit = vi.fn<(code: number) => void>();
    const source: SignalSource = {
      on: (event, listener) => emitter.on(event, listener),
      off: (event, listener) => emitter.off(event, listener),
      exit,
    };
    return { emitter, exit, source };
  }

  it('chama o encerramento e sai com 0', async () => {
    const { emitter, exit, source } = fakeProcess();
    const onShutdown = vi.fn(async () => {});
    handleShutdownSignals({ logger, onShutdown, source });
    emitter.emit('SIGTERM', 'SIGTERM');
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    expect(onShutdown).toHaveBeenCalledTimes(1);
  });

  it('segundo sinal força a saída com 1', () => {
    const { emitter, exit, source } = fakeProcess();
    handleShutdownSignals({ logger, onShutdown: () => new Promise(() => {}), source });
    emitter.emit('SIGINT', 'SIGINT');
    emitter.emit('SIGINT', 'SIGINT');
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('prazo esgotado sai com 1', async () => {
    const { emitter, exit, source } = fakeProcess();
    handleShutdownSignals({ logger, onShutdown: () => new Promise(() => {}), source, timeoutMs: 20 });
    emitter.emit('SIGTERM', 'SIGTERM');
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
  });

  it('falha no encerramento sai com 1', async () => {
    const { emitter, exit, source } = fakeProcess();
    handleShutdownSignals({ logger, onShutdown: async () => { throw new Error('falhou'); }, source });
    emitter.emit('SIGTERM', 'SIGTERM');
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
  });

  it('a função retornada remove os ouvintes', () => {
    const { emitter, source } = fakeProcess();
    const dispose = handleShutdownSignals({ logger, onShutdown: async () => {}, source });
    expect(emitter.listenerCount('SIGTERM')).toBe(1);
    dispose();
    expect(emitter.listenerCount('SIGTERM')).toBe(0);
  });
});
