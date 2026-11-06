import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// Testes leem os pacotes direto do código-fonte: não exigem build prévio
const alias = {
  '@disparazap/contracts': fromRoot('./packages/contracts/src/index.ts'),
  '@disparazap/db': fromRoot('./packages/db/src/index.ts'),
  '@disparazap/shared': fromRoot('./packages/shared/src/index.ts'),
};

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'node',
          environment: 'node',
          include: ['packages/*/src/**/*.spec.ts', 'apps/api/src/**/*.spec.ts', 'apps/worker/src/**/*.spec.ts'],
        },
      },
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: 'web',
          environment: 'jsdom',
          include: ['apps/web/src/**/*.spec.{ts,tsx}'],
          // Sob a carga da suíte inteira (API e painel em paralelo), 5 s não bastam para algumas telas grandes
          testTimeout: 20_000,
          // Espera maior nos testes da tela (veja o arquivo)
          setupFiles: ['apps/web/vitest.setup.ts'],
        },
      },
    ],
  },
});
