import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { healthLiveSchema, healthReadySchema } from '@disparazap/contracts';

const ENTRY = fileURLToPath(new URL('./index.ts', import.meta.url));
// Desde a autenticação, a API abre o banco embutido (PostgreSQL em WASM) e carrega o Better Auth antes de escutar.
// Numa máquina com a CPU ocupada isso levou cerca de 30 s (medido em 2026-11-01); a espera interna fica bem acima,
// e o limite do teste acima dela, para que a espera termine primeiro com uma mensagem clara.
const STARTUP_WAIT_MS = 90_000;
const PROCESS_TEST_TIMEOUT_MS = 120_000;
const children: ChildProcess[] = [];
afterEach(() => {
  for (const child of children.splice(0)) child.kill();
});

// Sobe o processo real (Node 24 executando o TypeScript direto), como `npm run dev:api` faria
function start(env: Record<string, string>) {
  const child = spawn(process.execPath, ['--conditions=source', ENTRY], {
    // Banco embutido só em memória: o teste nunca toca a pasta de dados de desenvolvimento
    env: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', DATABASE_EMBEDDED_DIR: 'memory://', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  let output = '';
  child.stdout?.on('data', (d) => { output += d; });
  child.stderr?.on('data', (d) => { output += d; });
  const exited = new Promise<number | null>((resolve) => child.on('exit', resolve));
  return { child, exited, output: () => output };
}

describe('processo da API', () => {
  it('inicia de forma independente, escuta em 127.0.0.1 e responde ao health check', { timeout: PROCESS_TEST_TIMEOUT_MS }, async () => {
    const api = start({ API_PORT: '0', LOG_LEVEL: 'info' });
    await expect.poll(() => api.output(), { timeout: STARTUP_WAIT_MS }).toMatch(/Server listening at http:\/\/127\.0\.0\.1:\d+/);
    const port = /127\.0\.0\.1:(\d+)/.exec(api.output())?.[1];
    const live = await fetch(`http://127.0.0.1:${port}/health/live`);
    expect(healthLiveSchema.parse(await live.json()).status).toBe('ok');
    // O banco abriu de verdade dentro do processo
    const ready = await fetch(`http://127.0.0.1:${port}/health/ready`);
    expect(healthReadySchema.parse(await ready.json())).toMatchObject({ status: 'ok', database: 'ok' });
  });

  it('configuração inválida impede a inicialização com mensagem clara e sem o valor', { timeout: PROCESS_TEST_TIMEOUT_MS }, async () => {
    const api = start({ API_PORT: 'porta-invalida-xyz' });
    expect(await api.exited).toBe(1);
    expect(api.output()).toContain('API_PORT');
    expect(api.output()).not.toContain('porta-invalida-xyz');
  });
});
