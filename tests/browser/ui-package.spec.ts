import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('http://127.0.0.1:5174');
  await expect(
    page.getByRole('region', { name: 'Stockroom' }).locator('[data-address="A1"]'),
  ).toHaveText('Part 1');
});
test('renders built exports without sales assumptions, persistence or a view', async ({ page }) => {
  const first = page.getByRole('region', { name: 'Stockroom' });
  const second = page.getByRole('region', { name: 'Workshop' });
  await expect(
    first.getByRole('columnheader').filter({ hasText: 'Double quantity' }),
  ).toBeVisible();
  await expect(first.locator('[data-address="D1"]')).toHaveText('25');
  await expect(second.locator('[data-address="B1"]')).toHaveText('12,5');
  await expect(first.getByRole('button', { name: 'Freeze', exact: true })).toHaveCount(0);
  await expect(first.getByRole('button', { name: 'Format', exact: true })).toHaveCount(0);
  await expect(first.getByRole('button', { name: /Column A menu/ })).toHaveCount(0);
  await expect(page.locator('.revision')).toHaveCount(0);
  expect((await first.getByTestId('grid').boundingBox())!.height).toBe(260);
  await first.getByRole('button', { name: 'Jump to item 100' }).click();
  await expect(first.locator('[data-address="A100"]')).toHaveText('Part 100');
  await expect(second.getByRole('textbox', { name: 'Go to cell' })).toHaveValue('A1');
  await expect(page.getByTestId('host-cell')).toHaveCSS('position', 'static');
  await expect(page.getByTestId('host-cell')).toHaveCSS('border-right-width', '0px');
});
test('keeps portals, editor focus and IDs local to each spreadsheet', async ({ page }) => {
  const first = page.getByRole('region', { name: 'Stockroom' });
  const second = page.getByRole('region', { name: 'Workshop' });
  await second.locator('[data-address="D1"]').dblclick();
  const editor = second.getByRole('textbox', { name: 'Edit D1', exact: true });
  await editor.fill('=SU');
  const formulaHelp = page.locator('.workshop-theme .sheet-portals .formula-assist');
  await expect(formulaHelp).toBeVisible();
  await expect(formulaHelp).toHaveCSS('background-color', 'rgb(255, 247, 214)');
  await expect(editor).toBeFocused();
  await editor.press('Escape');
  await second.locator('[data-address="B1"]').click();
  await page.keyboard.press('Control+Space');
  await page.keyboard.press('Shift+F10');
  const menu = page
    .locator('.workshop-theme .sheet-portals')
    .getByRole('dialog', { name: 'column actions' });
  await expect(menu).toBeVisible();
  await expect(menu).toHaveCSS('background-color', 'rgb(255, 247, 214)');
  await page.keyboard.press('Tab');
  await expect(
    menu.getByRole('button', { name: 'Insert column after', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(second.getByTestId('grid')).toBeFocused();
  await expect(first.getByTestId('grid')).not.toBeFocused();
  await second.getByRole('button', { name: 'Sort & filter' }).click();
  const dialog = page.locator('.workshop-theme .sheet-portals').getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '+ Add sort' }).click();
  await expect(
    dialog.getByLabel('Sort column 1').getByRole('option', { name: 'B · Quantity' }),
  ).toBeAttached();
  await page.keyboard.press('Escape');
  await expect(second.getByRole('button', { name: 'Sort & filter' })).toBeFocused();
  const duplicates = await page.locator('[id]').evaluateAll((nodes) => {
    const ids = nodes.map((node) => node.id);
    return ids.filter((id, i) => ids.indexOf(id) !== i);
  });
  expect(duplicates).toEqual([]);
});
test('leaves store ownership with the host across remounts', async ({ page }) => {
  const first = page.getByRole('region', { name: 'Stockroom' });
  const second = page.getByRole('region', { name: 'Workshop' });
  await first.locator('[data-address="A1"]').dblclick();
  await first.getByRole('textbox', { name: 'Edit A1', exact: true }).fill('Changed part');
  await page.keyboard.press('Enter');
  await page.getByTestId('toggle-first').click();
  await expect(first).toHaveCount(0);
  await expect(second.locator('[data-address="A1"]')).toHaveText('Part 1');
  await page.getByTestId('toggle-first').click();
  await expect(first.locator('[data-address="A1"]')).toHaveText('Changed part');
  await first.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(first.locator('[data-address="A1"]')).toHaveText('Part 1');
});
