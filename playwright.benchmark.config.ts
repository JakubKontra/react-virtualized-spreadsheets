import { defineConfig } from '@playwright/test';
import base from './playwright.config';
export default defineConfig({
  ...base,
  testDir: './benchmarks/browser',
  timeout: 120000,
  use: { ...base.use, launchOptions: { args: ['--enable-precise-memory-info'] } },
});
