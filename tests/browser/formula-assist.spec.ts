import { test, expect, type Page, type Locator } from '@playwright/test';

const cell = (page: Page, address: string) => page.locator(`[data-address="${address}"]`);
const popup = (page: Page) => page.locator('.formula-assist');
async function jump(page: Page, address: string) {
  const input = page.getByRole('textbox', { name: 'Go to cell' });
  await input.fill(address);
  await input.press('Enter');
  await expect(cell(page, address)).toHaveAttribute('data-status', 'ready');
}
async function expectBelow(page: Page, editor: Locator) {
  await expect(popup(page)).toBeVisible();
  await expect
    .poll(async () => {
      const box = (await editor.boundingBox())!;
      return Math.abs((await popup(page).boundingBox())!.y - box.y - box.height - 4);
    })
    .toBeLessThan(1);
}
async function expectWithinViewport(page: Page) {
  const box = (await popup(page).boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(8);
  expect(box.y).toBeGreaterThanOrEqual(8);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width - 8);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height - 8);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(cell(page, 'D1')).toHaveAttribute('data-status', 'ready');
});

test('anchors to J2 without shifting the grid and follows focus into the formula bar', async ({
  page,
}) => {
  await jump(page, 'J2');
  await cell(page, 'J2').dblclick();
  const editor = page.getByRole('textbox', { name: 'Edit J2', exact: true });
  const gridBefore = await page.getByTestId('grid').boundingBox();
  await editor.fill('=SUM');
  await expectBelow(page, editor);
  await expectWithinViewport(page);
  expect(await page.getByTestId('grid').boundingBox()).toEqual(gridBefore);
  await expect(editor).toBeFocused();

  const bar = page.getByRole('textbox', { name: 'Formula bar', exact: true });
  await bar.click();
  await expect(editor).toHaveCount(0);
  await expect(bar).toHaveValue('=SUM');
  await expectBelow(page, bar);
  expect((await popup(page).boundingBox())!.x).toBeCloseTo((await bar.boundingBox())!.x, 0);
  await page.getByRole('option', { name: /SUM/ }).click();
  await expect(bar).toBeFocused();
  await expect(bar).toHaveValue('=SUM(');
  await expect(popup(page)).toContainText('argument 1');
  await expect(cell(page, 'J2')).toHaveText('');
  await bar.press('Escape');
  await expect(popup(page)).toHaveCount(0);
});

test('tracks scroll, hides behind frozen panes, and stays attached to pinned cells', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Freeze', exact: true }).click();
  await page.getByLabel('Frozen rows', { exact: true }).fill('2');
  await page.getByLabel('Frozen columns', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Apply freeze' }).click();
  await cell(page, 'D5').dblclick();
  const editor = page.locator('.cell-editor');
  await editor.fill('=SUM(');
  await expectBelow(page, editor);
  const before = (await popup(page).boundingBox())!;
  const grid = page.getByTestId('grid');
  await grid.evaluate((el) => {
    el.scrollTop = 32;
  });
  await expect.poll(async () => (await popup(page).boundingBox())!.y).toBeCloseTo(before.y - 32, 0);
  await grid.evaluate((el) => {
    el.scrollTop = 96;
  });
  await expect(popup(page)).toBeHidden();
  await expect(editor).toHaveValue('=SUM(');
  await grid.evaluate((el) => {
    el.scrollTop = 0;
  });
  await expectBelow(page, editor);
  await grid.evaluate((el) => {
    el.scrollLeft = 500;
  });
  await expect(popup(page)).toBeHidden();
  await grid.evaluate((el) => {
    el.scrollLeft = 0;
  });
  await expectBelow(page, editor);
  await editor.press('Escape');

  await cell(page, 'A1').dblclick();
  await editor.fill('=SUM(');
  await expectBelow(page, editor);
  const pinned = await popup(page).boundingBox();
  await grid.evaluate((el) => {
    el.scrollTop = 5000;
    el.scrollLeft = 1000;
  });
  await expectBelow(page, editor);
  await expect.poll(async () => (await popup(page).boundingBox())!.x).toBeCloseTo(pinned!.x, 0);
  await expect.poll(async () => (await popup(page).boundingBox())!.y).toBeCloseTo(pinned!.y, 0);
  await expect(editor).toHaveValue('=SUM(');
});

test('flips above a bottom cell, scrolls long help, and follows page scrolling', async ({
  page,
}) => {
  await cell(page, 'D14').dblclick();
  const editor = page.locator('.cell-editor');
  await editor.fill('=SUM(' + Array.from({ length: 80 }, (_, i) => `E${i + 1}`).join(','));
  await expect(popup(page)).toBeVisible();
  await expect
    .poll(async () => {
      const box = (await popup(page).boundingBox())!;
      return Math.abs(box.y + box.height + 4 - (await editor.boundingBox())!.y);
    })
    .toBeLessThan(1);
  await expectWithinViewport(page);
  expect(await popup(page).evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  const before = (await popup(page).boundingBox())!;
  await page.evaluate(() => window.scrollBy(0, 100));
  await expect
    .poll(async () => (await popup(page).boundingBox())!.y)
    .toBeCloseTo(before.y - 100, 0);
  await expect(editor).toBeFocused();
});

test('keeps help inside a narrow viewport and repositions on resize', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await jump(page, 'J2');
  await cell(page, 'J2').dblclick();
  const editor = page.locator('.cell-editor');
  await editor.fill('=M');
  await expect(popup(page)).toBeVisible();
  await expectWithinViewport(page);
  await editor.press('ArrowDown');
  await expect(page.getByRole('option', { name: /MAX/ })).toHaveAttribute('aria-selected', 'true');
  await editor.press('Enter');
  await expect(editor).toHaveValue('=MAX(');
  await expect(editor).toBeFocused();
  await page.setViewportSize({ width: 320, height: 844 });
  await expect.poll(async () => (await popup(page).boundingBox())!.width).toBe(304);
  await expectWithinViewport(page);
  await editor.press('Escape');
  await expect(popup(page)).toHaveCount(0);
});
