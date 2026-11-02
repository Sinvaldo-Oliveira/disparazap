import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Só variáveis WEB_* (do saas/.env ou do ambiente), lidas aqui no servidor de desenvolvimento: nada vai para o navegador.
 * Não usa o loadEnv do Vite: ele aplicaria o NODE_ENV=development do saas/.env ao build, que viraria
 * build de desenvolvimento (React em modo de depuração, bundle bem maior).
 */
function webEnv(): Record<string, string> {
  const file = fileURLToPath(new URL('../../.env', import.meta.url));
  const fromFile = existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {};
  const pick = (source: Record<string, string | undefined>) =>
    Object.fromEntries(Object.entries(source).filter((entry): entry is [string, string] => entry[0].startsWith('WEB_') && typeof entry[1] === 'string'));
  return { ...pick(fromFile), ...pick(process.env) };
}

export default defineConfig(() => {
  const apiTarget = webEnv().WEB_API_PROXY_TARGET || 'http://127.0.0.1:3100';

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@disparazap/contracts': fileURLToPath(new URL('../../packages/contracts/src/index.ts', import.meta.url)),
      },
    },
    // Mesma origem para o navegador: o Vite repassa /health e /api para a API local (sem CORS)
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      proxy: { '/health': apiTarget, '/api': apiTarget },
    },
    preview: { host: '127.0.0.1', port: 4173, strictPort: true },
    build: { outDir: 'dist', sourcemap: true },
  };
});
