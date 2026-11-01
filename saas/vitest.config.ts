import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// Testes leem os pacotes direto do código-fonte: não exigem build prévio
const alias = {
  '@disparazap/contracts': fromRoot('./packages/contracts/src/index.ts'),
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
        },
      },
    ],
  },
});
