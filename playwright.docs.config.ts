import { defineConfig } from '@playwright/test';

const basePath =
  `/${(process.env.DOCS_BASE_URL ?? '').split('/').filter(Boolean).join('/')}/`.replace('//', '/');
export default defineConfig({
  testDir: './tests/docs',
  timeout: 30000,
  expect: { timeout: 10000 },
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:3107${basePath}`,
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command:
      'pnpm --filter @sheet/docs exec docusaurus serve --host 127.0.0.1 --port 3107 --no-open',
    url: `http://127.0.0.1:3107${basePath}`,
    reuseExistingServer: false,
    timeout: 30000,
  },
});
