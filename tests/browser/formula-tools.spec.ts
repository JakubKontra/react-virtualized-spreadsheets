import { test, expect, type Page } from '@playwright/test';
const cell = (page: Page, address: string) => page.locator(`[data-address="${address}"]`);
const bar = (page: Page) => page.getByRole('textbox', { name: 'Formula bar', exact: true });
async function edit(page: Page, address: string, value: string) {
  await cell(page, address).dblclick();
  await page.locator('.cell-editor').fill(value);
  await page.locator('.cell-editor').press('Enter');
  await expect(page.locator('.cell-editor')).toHaveCount(0);
}
async function copy(page: Page) {
  return page.getByTestId('grid').evaluate((el) => {
    const clipboardData = new DataTransfer();
    el.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, clipboardData }));
    return {
      text: clipboardData.getData('text/plain'),
      token: clipboardData.getData('application/x-ledger-clipboard'),
    };
  });
}
async function pasteIntoDialog(page: Page, data: { text: string; token?: string }) {
  await page.getByRole('button', { name: 'Paste special', exact: true }).click();
  await page.getByLabel('Copied cells').evaluate((el, data) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', data.text);
    if (data.token) clipboardData.setData('application/x-ledger-clipboard', data.token);
    el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData }));
  }, data);
}
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(cell(page, 'D1')).toHaveAttribute('data-status', 'ready');
});
test('transposes only internal formulas, preserves skipped targets and undoes the whole paste', async ({
  page,
}) => {
  await edit(page, 'D1', '10');
  await edit(page, 'E1', '=D1*2');
  await cell(page, 'D1').click();
  await cell(page, 'E1').click({ modifiers: ['Shift'] });
  const data = await copy(page);
  await cell(page, 'E4').click();
  await pasteIntoDialog(page, data);
  await page.getByRole('radio', { name: 'Formulas only', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Transpose rows and columns' }).check();
  await expect(page.locator('.paste-preview')).toHaveText('2 rows × 1 columns · starting at E4');
  await page.getByRole('button', { name: 'Apply paste', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(cell(page, 'E4')).toHaveText('€171.00');
  await expect(cell(page, 'E5')).toHaveText('€10.00');
  await cell(page, 'E5').click();
  await expect(bar(page)).toHaveValue('=D5*2');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(cell(page, 'E5')).toHaveText('€188.00');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(cell(page, 'E5')).toHaveText('€10.00');
});
test('pastes computed values, literal external text and persists the text through reload', async ({
  page,
}) => {
  await cell(page, 'G1').click();
  const data = await copy(page);
  await cell(page, 'H2').click();
  await pasteIntoDialog(page, data);
  await page.getByRole('radio', { name: 'Values only', exact: true }).check();
  await page.getByRole('button', { name: 'Apply paste', exact: true }).click();
  await expect(bar(page)).toHaveValue('120');
  await cell(page, 'A1').click();
  await pasteIntoDialog(page, { text: '=1+1' });
  await page.getByRole('radio', { name: 'Values only', exact: true }).check();
  await page.getByRole('button', { name: 'Apply paste', exact: true }).click();
  await expect(cell(page, 'A1')).toHaveText('=1+1');
  await expect(bar(page)).toHaveValue("'=1+1");
  await expect(page.locator('.revision')).toContainText('View saved');
  await page.reload();
  await expect(cell(page, 'A1')).toHaveText('=1+1');
});
test('retains rejected clipboard data and applies no partial writes', async ({ page }) => {
  await cell(page, 'A1').click();
  await pasteIntoDialog(page, { text: 'changed\tinvalid-date' });
  await page.getByRole('radio', { name: 'Values only', exact: true }).check();
  await page.getByRole('button', { name: 'Apply paste', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('date');
  await expect(page.getByLabel('Copied cells')).toHaveValue('changed\tinvalid-date');
  await expect(cell(page, 'A1')).toHaveText('ORD-0000001');
  // Modal dialogs hide the workbook from the accessibility tree until dismissed.
  await expect(
    page.getByRole('button', { name: 'Undo', exact: true, includeHidden: true }),
  ).toBeDisabled();
});
test('cycles F4 anchors in both editors and shows paired brackets and useful diagnostics', async ({
  page,
}) => {
  await cell(page, 'H1').dblclick();
  const editor = page.locator('.cell-editor');
  await editor.fill('=D1');
  for (const formula of ['=$D$1', '=D$1', '=$D1', '=D1']) {
    await editor.press('F4');
    await expect(editor).toHaveValue(formula);
    await expect(editor).toBeFocused();
  }
  await bar(page).click();
  await bar(page).press('End');
  await bar(page).press('F4');
  await expect(bar(page)).toHaveValue('=$D$1');
  await page.getByRole('button', { name: /Toggle \$ reference/ }).click();
  await expect(bar(page)).toHaveValue('=D$1');
  await expect(bar(page)).toBeFocused();
  await bar(page).fill('=SUM(');
  await expect(page.locator('.formula-diagnostic.incomplete')).toBeVisible();
  await bar(page).fill('=MISSING(1)');
  await expect(page.locator('.formula-diagnostic.error')).toHaveText('Unknown function MISSING');
  await bar(page).fill('=ROUND(1)');
  await expect(page.locator('.formula-diagnostic.error')).toHaveText('ROUND expects 2 arguments');
  await bar(page).fill('=SUM((D1),2)');
  await bar(page).press('Home');
  for (let i = 0; i < 6; i++) await bar(page).press('ArrowRight');
  await expect(page.locator('.formula-preview mark')).toHaveText(['(', ')']);
  await bar(page).press('Escape');
  await expect(cell(page, 'H1')).toHaveText('€28.80');
});
test('suggests the new functions and evaluates a full remote conditional aggregate', async ({
  page,
}) => {
  await cell(page, 'H1').dblclick();
  const editor = page.locator('.cell-editor');
  await editor.fill('=COUNTI');
  await page.getByRole('option', { name: /COUNTIF/ }).click();
  await expect(editor).toHaveValue('=COUNTIF(');
  await editor.fill('=COUNTIF(D1:D100000,">8")');
  await editor.press('Enter');
  await expect(cell(page, 'H1')).toHaveText('€11,111.00');
  await page.getByRole('button', { name: 'Live server', exact: true }).click();
  await expect(cell(page, 'D1')).toHaveAttribute('data-status', 'ready');
  await edit(page, 'H1', '=SUMIF($A$1:$A$1000000,"ORD-1000000",$E$1:$E$1000000)');
  await expect(cell(page, 'H1')).toHaveText('€263.00');
  expect(await page.locator('[role=gridcell]').count()).toBeLessThan(800);
});
