import { test, expect, type Page } from '@playwright/test';
const cell = (page: Page, address: string) => page.locator(`[data-address="${address}"]`);
async function edit(page: Page, address: string, value: string) {
  await cell(page, address).dblclick();
  const editor = page.getByRole('textbox', { name: `Edit ${address}`, exact: true });
  await editor.fill(value);
  await editor.press('Enter');
  await expect(editor).toHaveCount(0);
}
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(cell(page, 'D1')).toHaveAttribute('data-status', 'ready');
});
test('freezes both axes across a distant scroll without expanding the cell cache', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Freeze', exact: true }).click();
  await page.getByLabel('Frozen rows', { exact: true }).fill('2');
  await page.getByLabel('Frozen columns', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Apply freeze' }).click();
  const before = await cell(page, 'A1').boundingBox(),
    gridBefore = await page.getByTestId('grid').boundingBox();
  const jump = page.getByRole('textbox', { name: 'Go to cell' });
  await jump.fill('M90000');
  await jump.press('Enter');
  await expect(cell(page, 'M90000')).toHaveAttribute('data-status', 'ready');
  const after = await cell(page, 'A1').boundingBox();
  expect(after!.x).toBeCloseTo(before!.x, 0);
  expect(after!.y - (await page.getByTestId('grid').boundingBox())!.y).toBeCloseTo(
    before!.y - gridBefore!.y,
    0,
  );
  expect(await page.locator('[role=gridcell]').count()).toBeLessThan(800);
  await expect(cell(page, 'A1')).toHaveText('ORD-0000001');
  await expect(page.locator('.revision')).toContainText('View saved');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Freeze', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__sheet!.view!.getSnapshot().frozen)).toEqual({
    rows: 2,
    columns: 1,
  });
});
test('autofills numeric series by dragging and undoes the entire fill', async ({ page }) => {
  await edit(page, 'D1', '10');
  await edit(page, 'D2', '20');
  await cell(page, 'D1').click();
  await cell(page, 'D2').click({ modifiers: ['Shift'] });
  const handle = await page.getByRole('button', { name: 'Autofill selection' }).boundingBox(),
    target = await cell(page, 'D5').boundingBox();
  await page.mouse.move(handle!.x + 4, handle!.y + 4);
  await page.mouse.down();
  await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
  await expect(cell(page, 'D3')).toHaveText('30');
  await expect(cell(page, 'D5')).toHaveText('50');
  await expect(page.locator('.selection-summary')).toContainText('150');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(cell(page, 'D3')).toHaveText('3');
  await expect(cell(page, 'D5')).toHaveText('5');
});
test('completes a function and inserts a dragged range without committing early', async ({
  page,
}) => {
  await cell(page, 'H1').dblclick();
  const editor = page.getByRole('textbox', { name: 'Edit H1', exact: true });
  await editor.fill('=SU');
  await expect(page.getByRole('option', { name: /^SUM / })).toBeVisible();
  await editor.press('Tab');
  await expect(editor).toHaveValue('=SUM(');
  const from = await cell(page, 'D1').boundingBox(),
    to = await cell(page, 'D3').boundingBox();
  await page.mouse.move(from!.x + 20, from!.y + 15);
  await page.mouse.down();
  await page.mouse.move(to!.x + 20, to!.y + 15, { steps: 6 });
  await page.mouse.up();
  await expect(editor).toHaveValue('=SUM(D1:D3');
  await editor.press('End');
  await editor.press(')');
  await editor.press('Enter');
  await expect(cell(page, 'H1')).toHaveText('€6.00');
});
test('queries all rows, combines filters and sorts, and recovers from no matches', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Sort & filter' }).click();
  await page.getByRole('button', { name: '+ Add filter' }).click();
  await page.getByLabel('Filter column 1').selectOption('0');
  await page.getByLabel('Filter condition 1').selectOption('equals');
  await page.getByLabel('Filter value 1').fill('ORD-0100000');
  await page.getByRole('button', { name: '+ Add sort' }).click();
  await page.getByLabel('Sort column 1').selectOption('3');
  await page.getByLabel('Sort direction 1').selectOption('desc');
  await page.getByRole('button', { name: 'Apply query' }).click();
  await expect(cell(page, 'A100000')).toHaveText('ORD-0100000');
  await expect(page.locator('.sheet-size')).toContainText('1 rows');
  await page.getByRole('button', { name: /Sort & filter/ }).click();
  await page.getByLabel('Search all visible columns').fill('missing-value');
  await page.getByRole('button', { name: 'Apply query' }).click();
  await expect(page.getByText('No matching rows.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: /Sort & filter/ }).click();
  await page.getByRole('button', { name: 'Clear query' }).click();
  await expect(cell(page, 'A1')).toHaveText('ORD-0000001');
});
test('formats values, highlights conditions, persists named views and switches back', async ({
  page,
}) => {
  await cell(page, 'D1').click();
  await page.getByRole('button', { name: 'Format', exact: true }).click();
  await page.getByLabel('Cell type').selectOption('currency');
  await page.getByRole('combobox', { name: 'Currency', exact: true }).selectOption('USD');
  await page.getByLabel('Decimal places').fill('2');
  await page.getByRole('button', { name: '+ Add rule' }).click();
  await page.getByLabel('Rule condition 1').selectOption('gt');
  await page.getByLabel('Rule value 1').fill('0');
  await page.getByRole('button', { name: 'Apply format' }).click();
  await expect(cell(page, 'D1')).toHaveText('$1.00');
  await expect(cell(page, 'D1')).toHaveCSS('background-color', 'rgb(255, 228, 230)');
  await page.getByRole('button', { name: 'October sales', exact: true }).click();
  await page.getByLabel('View name', { exact: true }).fill('Finance');
  await page.getByRole('button', { name: 'Save as new view' }).click();
  await expect(page.getByRole('button', { name: 'Finance', exact: true })).toBeVisible();
  await expect(cell(page, 'D1')).toHaveText('$1.00');
  await page.getByRole('button', { name: 'Freeze', exact: true }).click();
  await page.getByLabel('Frozen columns', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Apply freeze' }).click();
  await page.getByRole('button', { name: 'Finance', exact: true }).click();
  await page.getByRole('button', { name: 'October sales →', exact: true }).click();
  await expect(page.getByRole('button', { name: 'October sales', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__sheet!.view!.getSnapshot().frozen)).toBeUndefined();
  await page.reload();
  await expect(page.getByRole('button', { name: 'October sales', exact: true })).toBeVisible();
});

test('validates select values and supports checkbox and date editors', async ({ page }) => {
  const jump = page.getByRole('textbox', { name: 'Go to cell' });
  await jump.fill('J1');
  await jump.press('Enter');
  await expect(cell(page, 'J1')).toHaveAttribute('data-status', 'ready');
  await page.getByRole('button', { name: 'Format', exact: true }).click();
  await page.getByLabel('Cell type').selectOption('select');
  await page.getByLabel('Choices (one per line)').fill('Draft\nApproved');
  await page.getByRole('button', { name: 'Apply format' }).click();
  await cell(page, 'J1').dblclick();
  const editor = page.getByRole('combobox', { name: 'Edit J1', exact: true });
  await editor.fill('Missing');
  await editor.press('Enter');
  await expect(page.getByRole('alert')).toContainText('Choose a value');
  await expect(editor).toHaveValue('Missing');
  await editor.fill('Approved');
  await editor.press('Enter');
  await expect(cell(page, 'J1')).toHaveText('Approved');
  await cell(page, 'K1').click();
  await page.getByRole('button', { name: 'Format', exact: true }).click();
  await page.getByLabel('Cell type').selectOption('checkbox');
  await page.getByRole('button', { name: 'Apply format' }).click();
  await page.getByRole('checkbox', { name: 'Toggle K1', exact: true }).check();
  await expect(page.getByRole('checkbox', { name: 'Toggle K1', exact: true })).toBeChecked();
  await jump.fill('B1');
  await jump.press('Enter');
  await cell(page, 'B1').dblclick();
  const date = page.getByLabel('Edit B1', { exact: true });
  await expect(date).toHaveAttribute('type', 'date');
  await date.fill('2024-02-29');
  await date.press('Enter');
  await expect(cell(page, 'B1')).toHaveText('2024-02-29');
});
test('filters the live million-row source to an unloaded record', async ({ page }) => {
  await page.getByRole('button', { name: 'Live server' }).click();
  await expect(cell(page, 'D1')).toHaveAttribute('data-status', 'ready');
  await page.getByRole('button', { name: 'Sort & filter' }).click();
  await page.getByRole('button', { name: '+ Add filter' }).click();
  await page.getByLabel('Filter column 1').selectOption('0');
  await page.getByLabel('Filter condition 1').selectOption('equals');
  await page.getByLabel('Filter value 1').fill('ORD-1000000');
  await page.getByRole('button', { name: 'Apply query' }).click();
  await expect(cell(page, 'A1000000')).toHaveText('ORD-1000000');
  await expect(page.locator('.sheet-size')).toContainText('1 rows');
  expect(await page.locator('[role=gridcell]').count()).toBeLessThan(100);
});
