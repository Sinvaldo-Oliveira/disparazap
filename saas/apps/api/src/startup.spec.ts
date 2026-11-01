import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { healthLiveSchema } from '@disparazap/contracts';

const ENTRY = fileURLToPath(new URL('./index.ts', import.meta.url));
// Subir um processo Node real pode levar alguns segundos sob carga; o padrão de 5 s do Vitest é curto.
// Fica acima da espera interna de 15 s, para que ela termine primeiro com uma mensagem clara.
const PROCESS_TEST_TIMEOUT_MS = 30_000;
const children: ChildProcess[] = [];
afterEach(() => {
  for (const child of children.splice(0)) child.kill();
});

// Sobe o processo real (Node 24 executando o TypeScript direto), como `npm run dev:api` faria
function start(env: Record<string, string>) {
  const child = spawn(process.execPath, ['--conditions=source', ENTRY], {
    env: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', ...env },
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
    await expect.poll(() => api.output(), { timeout: 15_000 }).toMatch(/Server listening at http:\/\/127\.0\.0\.1:\d+/);
    const port = /127\.0\.0\.1:(\d+)/.exec(api.output())?.[1];
    const res = await fetch(`http://127.0.0.1:${port}/health/live`);
    expect(healthLiveSchema.parse(await res.json()).status).toBe('ok');
  });

  it('configuração inválida impede a inicialização com mensagem clara e sem o valor', { timeout: PROCESS_TEST_TIMEOUT_MS }, async () => {
    const api = start({ API_PORT: 'porta-invalida-xyz' });
    expect(await api.exited).toBe(1);
    expect(api.output()).toContain('API_PORT');
    expect(api.output()).not.toContain('porta-invalida-xyz');
  });
});
