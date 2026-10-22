import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { cpus, platform } from 'node:os';

test('records local and server performance with bounded DOM/cache', async ({ page, browser }) => {
  const started = Date.now();
  await page.goto('/');
  await expect(page.locator('[data-address="D1"]')).toHaveText('1');
  const firstDisplayMs = Date.now() - started;
  const local = await page.evaluate(async () => {
    const store = window.__sheet!;
    const samples: number[] = [];
    for (let i = 0; i < 40; i++) {
      const before = performance.now();
      await store.edit([{ row: 0, col: 3, input: i + 1 }]);
      await store.ensureRange({ start: { row: 0, col: 0 }, end: { row: 1, col: 7 } });
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      samples.push(performance.now() - before);
    }
    samples.sort((a, b) => a - b);
    return {
      editToFrameP95Ms: samples[Math.floor(samples.length * 0.95)],
      samples,
      domCells: document.querySelectorAll('[role=gridcell]').length,
      cache: store.cacheStats,
    };
  });
  const scroll = await page.evaluate(async () => {
    const grid = document.querySelector<HTMLElement>('[data-testid=grid]')!;
    const frames: number[] = [];
    let last = performance.now();
    let maxDom = 0;
    for (let i = 0; i < 120; i++) {
      grid.scrollTop = i * 20000;
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const now = performance.now();
      frames.push(now - last);
      last = now;
      maxDom = Math.max(maxDom, document.querySelectorAll('[role=gridcell]').length);
    }
    frames.sort((a, b) => a - b);
    return {
      frameP95Ms: frames[Math.floor(frames.length * 0.95)],
      maxDom,
      cache: window.__sheet!.cacheStats,
      heapMiB: (performance as any).memory?.usedJSHeapSize / 1048576,
    };
  });
  expect(local.editToFrameP95Ms).toBeLessThan(100);
  expect(scroll.maxDom).toBeLessThan(600);
  expect(scroll.cache.blocks).toBeLessThanOrEqual(48);
  await page.getByRole('button', { name: 'Live server' }).click();
  await expect(page.locator('[data-address="D1"]')).toHaveAttribute('data-status', 'ready');
  await page.getByRole('textbox', { name: 'Go to cell' }).fill('AX1000000');
  await page.getByRole('textbox', { name: 'Go to cell' }).press('Enter');
  await expect(page.locator('[data-address="AX1000000"]')).toHaveAttribute('data-status', 'ready');
  const remote = await page.evaluate(() => ({
    domCells: document.querySelectorAll('[role=gridcell]').length,
    cache: window.__sheet!.cacheStats,
    heapMiB: (performance as any).memory?.usedJSHeapSize / 1048576,
  }));
  expect(remote.domCells).toBeLessThan(600);
  expect(remote.cache.blocks).toBeLessThanOrEqual(48);
  const result = {
    timestamp: new Date().toISOString(),
    browser: browser.version(),
    cpu: cpus()[0]?.model,
    platform: platform(),
    mode: 'Vite development build, headless Chromium, 1440x1000',
    firstDisplayMs,
    local,
    scroll,
    remote,
  };
  await mkdir('benchmark-results', { recursive: true });
  await writeFile('benchmark-results/browser.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
});
