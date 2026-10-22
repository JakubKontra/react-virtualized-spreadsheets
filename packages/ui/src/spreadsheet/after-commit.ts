import type { SpreadsheetController } from '@sheet/react';

/** Runs `action` once a pending edit is committed; a failed commit keeps the editor open. */
export function afterCommit(sheet: SpreadsheetController, action: () => void): void {
  void sheet.edit.commit().then((ok) => {
    if (ok) action();
  });
}
