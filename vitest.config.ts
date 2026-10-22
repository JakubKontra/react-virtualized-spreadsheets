import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: {
    alias: {
      '@sheet/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      '@sheet/transport': fileURLToPath(
        new URL('./packages/transport/src/index.ts', import.meta.url),
      ),
    },
  },
  test: { include: ['tests/**/*.test.ts'], testTimeout: 15000 },
});
