import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';

const root = fileURLToPath(new URL('..', import.meta.url));
const directory = await mkdtemp(join(tmpdir(), 'sheet-ui-package-'));
const run = (args, cwd = root) => execFileSync('pnpm', args, { cwd, stdio: 'pipe' });
let browser, server;
try {
  const overrides = {};
  for (const name of ['core', 'react', 'transport', 'ui']) {
    run(['pack', '--pack-destination', directory], join(root, 'packages', name));
    const { version } = JSON.parse(
      await readFile(join(root, 'packages', name, 'package.json'), 'utf8'),
    );
    overrides[`@sheet/${name}`] = `file:${join(directory, `sheet-${name}-${version}.tgz`)}`;
  }
  const app = join(directory, 'consumer');
  await cp(join(root, 'apps/ui-example'), app, {
    recursive: true,
    filter: (path) => !/\/(node_modules|dist)(\/|$)/.test(path),
  });
  const workspace = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(join(app, 'package.json'), 'utf8'));
  manifest.dependencies = { ...manifest.dependencies, ...overrides };
  manifest.devDependencies = Object.fromEntries(
    ['vite', '@vitejs/plugin-react', '@tailwindcss/vite', 'tailwindcss'].map((name) => [
      name,
      workspace.devDependencies[name],
    ]),
  );
  manifest.pnpm = { overrides };
  await writeFile(join(app, 'package.json'), JSON.stringify(manifest, null, 2));
  run(['install', '--ignore-scripts'], app);
  run(['exec', 'vite', 'build'], app);
  // Load the production output from the isolated tarball consumer.
  server = createServer(async (req, res) => {
    try {
      const path = req.url === '/' ? '/index.html' : req.url.split('?')[0];
      if (!/^\/(?:index\.html|assets\/[\w.-]+)$/.test(path)) {
        res.writeHead(404).end();
        return;
      }
      res.setHeader(
        'Content-Type',
        path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html',
      );
      res.end(await readFile(join(app, 'dist', path)));
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const stock = page.getByRole('region', { name: 'Stockroom' });
  await stock.locator('[data-address="D1"]').filter({ hasText: '25' }).waitFor();
  await stock.getByRole('button', { name: 'Paste special' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  const styles = await dialog
    .getByRole('button', { name: 'Cancel', exact: true })
    .evaluate((el) => ({
      display: getComputedStyle(el).display,
      radius: getComputedStyle(el).borderRadius,
    }));
  if (!['flex', 'inline-flex'].includes(styles.display) || styles.radius === '0px')
    throw new Error(`Missing shipped Tailwind sources: ${JSON.stringify(styles)}`);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await stock.locator('[data-address="A1"]').dblclick();
  const editor = stock.getByRole('textbox', { name: 'Edit A1', exact: true });
  await editor.fill('Packed component');
  await editor.press('Enter');
  await stock.locator('[data-address="A1"]').filter({ hasText: 'Packed component' }).waitFor();
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(
    'Packed @sheet/ui: independent install, production build, Tailwind styles and editing passed.',
  );
} catch (error) {
  if (error.stdout) console.error(error.stdout.toString());
  if (error.stderr) console.error(error.stderr.toString());
  throw error;
} finally {
  await browser?.close();
  await new Promise((resolve) => (server ? server.close(resolve) : resolve()));
  await rm(directory, { recursive: true, force: true });
}
