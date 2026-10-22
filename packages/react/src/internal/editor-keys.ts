import type { KeyboardEvent } from 'react';

/** Data attribute marking the inputs owned by one spreadsheet instance. */
export const SHEET_EDITOR_ATTRIBUTE = 'data-sheet-editor';

export const isSheetEditor = (element: EventTarget | null, prefix: string): boolean =>
  element instanceof HTMLElement && element.getAttribute(SHEET_EDITOR_ATTRIBUTE) === prefix;

/** Home/End move the caret inside the editor instead of scrolling the grid. */
export function handleCaretKeys(event: KeyboardEvent<HTMLInputElement>): boolean {
  if (event.key !== 'Home' && event.key !== 'End') return false;
  event.preventDefault();
  const input = event.currentTarget;
  const position = event.key === 'Home' ? 0 : input.value.length;
  if (input.type !== 'date')
    input.setSelectionRange(
      event.shiftKey ? Math.min(input.selectionStart ?? 0, position) : position,
      event.shiftKey ? Math.max(input.selectionEnd ?? 0, position) : position,
    );
  return true;
}
