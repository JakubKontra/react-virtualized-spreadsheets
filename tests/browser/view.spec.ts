import { expect, test, type Page } from '@playwright/test';
const cell = (page: Page, address: string) => page.locator(`[data-address="${address}"]`);
const state = (page: Page) => page.evaluate(() => window.__sheet!.getSnapshot());
async function loaded(page: Page) {
  await expect(cell(page, 'D1')).toHaveAttribute('data-status', 'ready');
}
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await loaded(page);
});

test('snaps a column drag to the boundary, preserves formulas and undoes in one step', async ({
  page,
}) => {
  const handle = page.getByRole('button', { name: 'Move column 4', exact: true });
  const start = (await handle.boundingBox())!;
  const target = (await page.locator('[role=columnheader][aria-colindex="2"]').boundingBox())!;
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + 20, target.y + 15, { steps: 10 });
  const line = page.getByTestId('drop-line');
  await expect(line).toBeVisible();
  expect(Math.abs((await line.boundingBox())!.x - target.x)).toBeLessThan(2);
  await page.mouse.up();
  await expect(cell(page, 'B1')).toHaveText('1');
  await expect(cell(page, 'G1')).toHaveText('€120.00');
  await cell(page, 'G1').click();
  await expect(page.getByRole('textbox', { name: 'Formula bar', exact: true })).toHaveValue(
    '=((B1*E1)*(1-F1))',
  );
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(cell(page, 'D1')).toHaveText('1');
  await expect(cell(page, 'B1')).toHaveText('2026-10-01');
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
});

test('moves a selected row block and cancels a later drag without a history entry', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Move row 2', exact: true }).click();
  await page
    .getByRole('button', { name: 'Move row 3', exact: true })
    .click({ modifiers: ['Shift'] });
  expect((await state(page)).selectionKind).toBe('rows');
  expect((await state(page)).selection.end.row).toBe(2);
  const handle = (await page
    .getByRole('button', { name: 'Move row 2', exact: true })
    .boundingBox())!;
  const target = (await page
    .getByRole('button', { name: 'Move row 6', exact: true })
    .boundingBox())!;
  await page.mouse.move(handle.x + 20, handle.y + 15);
  await page.mouse.down();
  await page.mouse.move(target.x + 20, target.y + 4, { steps: 8 });
  await expect(page.getByTestId('drop-line')).toBeVisible();
  await page.mouse.up();
  await expect(cell(page, 'A2')).toHaveText('ORD-0000004');
  await expect(cell(page, 'A4')).toHaveText('ORD-0000002');
  await expect(cell(page, 'A5')).toHaveText('ORD-0000003');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(cell(page, 'A2')).toHaveText('ORD-0000002');
  await page.mouse.move(handle.x + 20, handle.y + 15);
  await page.mouse.down();
  await page.mouse.move(target.x + 20, target.y + 4, { steps: 8 });
  await expect(page.getByTestId('drop-line')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.getByTestId('drop-line')).toHaveCount(0);
  await expect(cell(page, 'A2')).toHaveText('ORD-0000002');
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
});

test('inserts, edits and removes a custom row; source rows offer hide and restore', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Move row 2', exact: true }).click({ button: 'right' });
  await expect(page.getByRole('button', { name: 'Remove custom row', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Insert row above', exact: true }).click();
  await expect(cell(page, 'A3')).toHaveText('ORD-0000002');
  await cell(page, 'D2').dblclick();
  await page.getByRole('textbox', { name: 'Edit D2', exact: true }).fill('99');
  await page.keyboard.press('Enter');
  await expect(cell(page, 'D2')).toHaveText('99');
  await page.getByRole('button', { name: 'Move row 2', exact: true }).click({ button: 'right' });
  await page.getByRole('button', { name: 'Remove custom row', exact: true }).click();
  await expect(cell(page, 'A2')).toHaveText('ORD-0000002');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(cell(page, 'D2')).toHaveText('99');
  await page.getByRole('button', { name: 'Move row 3', exact: true }).click({ button: 'right' });
  await page.getByRole('button', { name: 'Hide row', exact: true }).click();
  await expect(cell(page, 'A3')).toHaveCount(0);
  await expect(cell(page, 'A4')).toHaveText('ORD-0000003');
  await page.getByRole('button', { name: 'Move row 1', exact: true }).click({ button: 'right' });
  await page.getByRole('button', { name: 'Show hidden rows', exact: true }).click();
  await expect(cell(page, 'A3')).toHaveText('ORD-0000002');
});

test('resizes rows and columns, aligns editors, and restores the view after reload', async ({
  page,
}) => {
  const resize = page.getByRole('separator', { name: 'Resize column 1', exact: true });
  const start = (await resize.boundingBox())!;
  await page.mouse.move(start.x + 3, start.y + 15);
  await page.mouse.down();
  await page.mouse.move(start.x + 83, start.y + 15, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await cell(page, 'A1').boundingBox())?.width).toBe(234);
  await page.getByRole('button', { name: 'Move row 1', exact: true }).click({ button: 'right' });
  await page.getByLabel('Height (px)').fill('64');
  await page.getByRole('button', { name: 'Apply size', exact: true }).click();
  await expect.poll(async () => (await cell(page, 'A1').boundingBox())?.height).toBe(64);
  await cell(page, 'A1').dblclick();
  const editor = page.getByRole('textbox', { name: 'Edit A1', exact: true });
  const bounds = (await editor.boundingBox())!;
  expect(bounds.width).toBe(234);
  expect(bounds.height).toBe(64);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('status')).toContainText('View saved');
  await page.reload();
  await loaded(page);
  expect((await cell(page, 'A1').boundingBox())?.width).toBe(234);
  expect((await cell(page, 'A1').boundingBox())?.height).toBe(64);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
});

test('formula bar commits on click-away and preserves rejected drafts', async ({ page }) => {
  await cell(page, 'D1').click();
  const formula = page.getByRole('textbox', { name: 'Formula bar', exact: true });
  await formula.fill('42');
  await cell(page, 'E1').click();
  await expect(cell(page, 'D1')).toHaveText('42');
  await cell(page, 'D1').click();
  await formula.fill('57');
  await formula.press('Escape');
  await expect(cell(page, 'D1')).toHaveText('42');
  await page.getByRole('button', { name: 'Live server' }).click();
  await loaded(page);
  await cell(page, 'G1').click();
  await formula.fill('invalid');
  await cell(page, 'H1').click();
  await expect(formula).toHaveValue('invalid');
  await expect(page.getByRole('alert')).toContainText('formula');
  expect((await state(page)).editing?.col).toBe(6);
  await formula.fill('=D1*2');
  await formula.press('Enter');
  await expect.poll(async () => (await state(page)).editing).toBe(null);
});

test('supports keyboard menus and select all without materializing the dataset', async ({
  page,
}) => {
  await cell(page, 'D1').click();
  await page.keyboard.press('Control+Space');
  expect((await state(page)).selectionKind).toBe('columns');
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('dialog', { name: 'column actions' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Insert column before', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('grid')).toBeFocused();
  await page.keyboard.press('Shift+Space');
  expect((await state(page)).selectionKind).toBe('rows');
  await page.getByRole('button', { name: 'Select all cells', exact: true }).click();
  expect((await state(page)).selectionKind).toBe('all');
  expect(await page.locator('[role=gridcell]').count()).toBeLessThan(600);
});

test('auto-scrolls a row drag near the viewport edge and cancels cleanly', async ({ page }) => {
  const handle = (await page
    .getByRole('button', { name: 'Move row 2', exact: true })
    .boundingBox())!;
  const grid = page.getByTestId('grid');
  const rect = (await grid.boundingBox())!;
  await page.mouse.move(handle.x + 20, handle.y + 15);
  await page.mouse.down();
  await page.mouse.move(handle.x + 20, rect.y + rect.height - 6, { steps: 10 });
  await expect.poll(() => grid.evaluate((element) => element.scrollTop)).toBeGreaterThan(100);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.getByTestId('drop-line')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
});

test('hands the same draft from the cell editor to the formula bar and commits on Tab', async ({
  page,
}) => {
  await cell(page, 'D1').dblclick();
  await page.getByRole('textbox', { name: 'Edit D1', exact: true }).fill('73');
  const formula = page.getByRole('textbox', { name: 'Formula bar', exact: true });
  await formula.click();
  await expect(formula).toHaveValue('73');
  await expect(formula).toBeFocused();
  await formula.press('Tab');
  await expect(cell(page, 'D1')).toHaveText('73');
  await expect(page.getByRole('textbox', { name: 'Edit D1', exact: true })).toHaveCount(0);
});

test('reorders the final server row among a million records with bounded DOM and view state', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Live server' }).click();
  await loaded(page);
  const jump = page.getByRole('textbox', { name: 'Go to cell' });
  await jump.fill('A1000000');
  await jump.press('Enter');
  await expect(cell(page, 'A1000000')).toHaveText('ORD-1000000');
  await page
    .getByRole('button', { name: 'Move row 1000000', exact: true })
    .click({ button: 'right' });
  await page.getByRole('button', { name: 'Move up', exact: true }).click();
  await expect(cell(page, 'A999999')).toHaveText('ORD-1000000');
  await expect(cell(page, 'A1000000')).toHaveText('ORD-0999999');
  expect(await page.locator('[role=gridcell]').count()).toBeLessThan(600);
  const compact = await page.evaluate(() => ({
    bytes: JSON.stringify(window.__sheet!.view!.getSnapshot()).length,
    blocks: window.__sheet!.cacheStats.blocks,
  }));
  expect(compact.bytes).toBeLessThan(8000);
  expect(compact.blocks).toBeLessThanOrEqual(48);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(cell(page, 'A1000000')).toHaveText('ORD-1000000');
});
