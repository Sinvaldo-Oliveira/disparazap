import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const saasRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig(({ mode }) => {
  // Só variáveis WEB_* do saas/.env, lidas aqui no servidor de desenvolvimento — nada vai para o navegador
  const env = loadEnv(mode, saasRoot, 'WEB_');
  const apiTarget = env.WEB_API_PROXY_TARGET || 'http://127.0.0.1:3100';

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
