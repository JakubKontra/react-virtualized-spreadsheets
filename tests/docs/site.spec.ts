import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  // All examples and search must work using only the static documentation host.
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      if (url.origin !== 'http://127.0.0.1:3107') {
        await route.abort();
        throw new Error(`Unexpected external request: ${url.href}`);
      }
    }
    await route.continue();
  });
});

async function example(page: Page, name: string) {
  await page.goto(`docs/examples/${name}/`);
  await page.locator('.live-example').scrollIntoViewIfNeeded();
  const frame = page.frameLocator('.live-example iframe');
  await expect(frame.locator('[data-address="A1"]').first()).toBeVisible();
  return frame;
}

test('homepage, navigation and locally indexed search', async ({ page }) => {
  await page.goto('./');
  await expect(
    page.getByRole('heading', { name: 'A spreadsheet. Part of your app.' }),
  ).toBeVisible();
  const repository = page.getByRole('link', { name: /^Repository/ });
  if (process.env.DOCS_REPOSITORY_URL)
    await expect(repository).toHaveAttribute(
      'href',
      process.env.DOCS_REPOSITORY_URL.replace(/\/$/, ''),
    );
  else await expect(repository).toHaveCount(0);
  await page.getByRole('link', { name: 'Start building' }).click();
  await expect(page.getByRole('heading', { name: 'Installation', exact: true })).toBeVisible();
  const search = page.getByPlaceholder('Search', { exact: true });
  await search.fill('autofill');
  await page
    .getByRole('option', { name: 'Autofill Editing, layout and formatting', exact: true })
    .click();
  await expect(page).toHaveURL(/docs\/.*(?:interactions|formulas|views|store|overview|roadmap)/);
  await expect(page.locator('main')).toContainText(/autofill/i);
});

test('editing recalculates, theme changes preserve data, and reset restores inputs', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const frame = await example(page, 'basic');
  await frame.locator('[data-address="A1"]').dblclick();
  const editor = frame.getByRole('textbox', { name: 'Edit A1', exact: true });
  await editor.fill('200');
  await editor.press('Enter');
  await expect(frame.locator('[data-address="A3"]')).toHaveText('280');
  await expect(frame.locator('[data-address="B1"]')).toHaveText('242');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole('button', { name: /Switch between dark and light mode/ }).click();
  // Docusaurus cycles system/light/dark; select dark explicitly if the first click was light.
  if ((await page.locator('html').getAttribute('data-theme')) !== 'dark')
    await page.getByRole('button', { name: /Switch between dark and light mode/ }).click();
  await expect(frame.locator('html')).toHaveClass(/dark/);
  await expect(frame.locator('[data-address="A1"]')).toHaveText('200');
  await frame.getByRole('button', { name: 'Reset data' }).click();
  await expect(frame.locator('[data-address="A1"]')).toHaveText('120');
  await expect(frame.locator('[data-address="A3"]')).toHaveText('200');
  expect(errors).toEqual([]);
});

test('inventory queries the whole dataset and quotation recalculates totals', async ({ page }) => {
  let frame = await example(page, 'inventory');
  await frame.getByRole('button', { name: 'Show low stock' }).click();
  await expect(frame.locator('[data-address="A21"]')).toHaveText('Part 021');
  await expect(frame.locator('[data-address="A6"]')).toHaveCount(0);
  await frame.getByRole('button', { name: 'Reset data' }).click();
  await expect(frame.getByRole('button', { name: 'Show low stock' })).toBeVisible();
  frame = await example(page, 'quotation');
  await frame.locator('[data-address="B1"]').dblclick();
  const editor = frame.getByRole('textbox', { name: 'Edit B1', exact: true });
  await editor.fill('20');
  await editor.press('Enter');
  await expect(frame.locator('[data-address="E1"]')).toHaveText('€1,700.00');
  await expect(frame.locator('[data-address="E4"]')).toHaveText('€4,416.00');
});

test('two stores remain independent', async ({ page }) => {
  const frame = await example(page, 'independent');
  const first = frame.getByRole('region', { name: 'Warehouse A', exact: true });
  const second = frame.getByRole('region', { name: 'Warehouse B', exact: true });
  await first.locator('[data-address="A1"]').dblclick();
  const editor = first.getByRole('textbox', { name: 'Edit A1', exact: true });
  await editor.fill('70');
  await editor.press('Enter');
  await expect(first.locator('[data-address="B1"]')).toHaveText('140');
  await expect(second.locator('[data-address="A1"]')).toHaveText('25');
  await expect(second.locator('[data-address="B1"]')).toHaveText('50');
});

test('mobile navigation and embedded viewport fit the page', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole('button', { name: 'Toggle navigation bar' }).click();
  await page.locator('.navbar-sidebar').getByRole('link', { name: 'Roadmap', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Roadmap', exact: true })).toBeVisible();
  const frame = await example(page, 'basic');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expect
    .poll(() =>
      frame
        .locator('html')
        .evaluate(
          (element) =>
            element.scrollWidth <= element.clientWidth &&
            element.scrollHeight <= element.clientHeight,
        ),
    )
    .toBe(true);
  await frame.locator('[data-address="A1"]').dblclick();
  await expect(frame.getByRole('textbox', { name: 'Edit A1', exact: true })).toBeFocused();
  await frame.getByRole('textbox', { name: 'Edit A1', exact: true }).press('Escape');
  await frame.getByRole('button', { name: 'Reset data' }).click();
  await expect(frame.locator('[data-address="A1"]')).toHaveText('120');
});
