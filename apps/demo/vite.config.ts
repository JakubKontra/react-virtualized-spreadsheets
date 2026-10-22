import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  resolve: {
    alias: {
      '@sheet/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
      '@sheet/react': fileURLToPath(new URL('../../packages/react/src/index.ts', import.meta.url)),
      '@sheet/transport': fileURLToPath(
        new URL('../../packages/transport/src/index.ts', import.meta.url),
      ),
    },
  },
  worker: { format: 'es' },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: { '/api': `http://127.0.0.1:${process.env.SHEET_PORT ?? 4317}` },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
