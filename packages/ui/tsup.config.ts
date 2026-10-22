import { defineConfig } from 'tsup';
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  splitting: true,
  external: ['@sheet/core', '@sheet/react'],
  banner: { js: "'use client';" },
});
