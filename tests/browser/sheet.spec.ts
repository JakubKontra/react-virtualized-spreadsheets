import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-address="D1"]')).toHaveText('1');
});
test('preserves an editor draft through scrolling and commits when selecting another cell', async ({
  page,
}) => {
  await page.locator('[data-address="D1"]').dblclick();
  const editor = page.getByRole('textbox', { name: 'Edit D1', exact: true });
  await editor.fill('42');
  await page.getByTestId('grid').evaluate((element) => {
    element.scrollTop = 100000;
  });
  await expect(editor).toHaveValue('42');
  await expect(editor).toBeFocused();
  await page.getByTestId('grid').evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.locator('[data-address="E1"]').click();
  await expect(page.locator('[data-address="D1"]')).toHaveText('42');
  await expect(editor).toHaveCount(0);
});
test('edits formulas, selects ranges, copies relatively, and undoes a paste', async ({ page }) => {
  await page.locator('[data-address="D1"]').dblclick();
  await page.getByRole('textbox', { name: 'Edit D1', exact: true }).fill('10');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-address="G1"]')).toHaveText('€1,200.00');
  await page.locator('[data-address="G1"]').click();
  await page.getByTestId('grid').evaluate((element) => {
    const event = new ClipboardEvent('copy', { bubbles: true, clipboardData: new DataTransfer() });
    element.dispatchEvent(event);
    (window as any).__copied = event.clipboardData!.getData('text/plain');
    (window as any).__copyToken = event.clipboardData!.getData('application/x-ledger-clipboard');
  });
  await page.locator('[data-address="G2"]').click();
  await page.getByTestId('grid').evaluate((element) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', (window as any).__copied);
    clipboardData.setData('application/x-ledger-clipboard', (window as any).__copyToken);
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData }));
  });
  await expect(page.getByRole('textbox', { name: 'Formula bar', exact: true })).toHaveValue(
    '=D2*E2*(1-F2)',
  );
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeEnabled();
  await page.locator('[data-address="A1"]').click();
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  await expect(page.locator('[role=gridcell][aria-selected=true]')).toHaveCount(4);
});
test('keeps DOM bounded and navigation/focus working far outside the initial viewport', async ({
  page,
}) => {
  const initial = await page.locator('[role=gridcell]').count();
  expect(initial).toBeLessThan(600);
  await page.getByRole('textbox', { name: 'Go to cell' }).fill('AX100000');
  await page.getByRole('textbox', { name: 'Go to cell' }).press('Enter');
  await expect(page.locator('[data-address="AX100000"]')).toBeVisible();
  await expect(page.getByTestId('grid')).toBeFocused();
  expect(await page.locator('[role=gridcell]').count()).toBeLessThan(600);
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('textbox', { name: 'Go to cell' })).toHaveValue('AX99999');
  await page.keyboard.press('Enter');
  await page.getByRole('textbox', { name: 'Edit AX99999' }).fill('=SUM(D1:D100000)');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-address="AX99999"]')).toHaveText('499,996');
  await page.getByTestId('grid').evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.waitForTimeout(100);
  await page.getByRole('textbox', { name: 'Go to cell' }).fill('AX99999');
  await page.getByRole('textbox', { name: 'Go to cell' }).press('Enter');
  await expect(page.locator('[data-address="AX99999"]')).toHaveText('499,996');
});
test('server mode computes unseen rows, preserves read-only data, and receives updates', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Live server' }).click();
  await expect(page.locator('[data-address="D1"]')).toHaveAttribute('data-status', 'ready');
  await page.locator('[data-address="D1"]').dblclick();
  await expect(page.getByRole('alert')).toContainText('read-only');
  await page.getByRole('button', { name: 'Dismiss error' }).click();
  await page.getByRole('button', { name: 'Add calculation' }).click();
  const editor = page.getByRole('textbox', { name: 'Edit I1', exact: true });
  await expect(editor).toHaveValue('=SUM($D$1:$D$1000000)');
  await editor.press('Enter');
  await expect(editor).toHaveCount(0);
  await expect(page.locator('[data-address="I1"]')).toContainText(/\d/);
  await expect(page.locator('[data-address="I1"]')).toHaveAttribute('data-status', 'ready');
  const value = await page.locator('[data-address="I1"]').innerText();
  expect(Number(value.replaceAll(',', ''))).toBeGreaterThanOrEqual(4999996);
  await expect(page.locator('[data-address="I1"]')).not.toHaveText(value, { timeout: 15000 });
});
