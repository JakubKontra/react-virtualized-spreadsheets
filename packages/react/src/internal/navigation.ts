import { Address, CellRange, ColIndex, RowIndex, type SelectionKind } from '@sheet/core';

export interface KeyInput {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
}
export interface NavigationContext {
  readonly active: Address;
  /** Normalized selection. */
  readonly selection: CellRange;
  readonly selectionKind: SelectionKind;
  readonly rows: number;
  readonly columns: number;
  /** Rows moved by PageUp/PageDown. */
  readonly pageRows: number;
}
/** A header addressed by axis, with an index of that axis. */
export type AxisTarget =
  | { readonly axis: 'rows'; readonly index: RowIndex }
  | { readonly axis: 'columns'; readonly index: ColIndex };

/** What a key press on the grid means, independent of React and the DOM. */
export type GridCommand =
  | { readonly type: 'fill'; readonly source: CellRange; readonly target: CellRange }
  | { readonly type: 'undo' }
  | { readonly type: 'redo' }
  | { readonly type: 'selectAll' }
  | ({ readonly type: 'selectAxis' } & AxisTarget)
  | ({ readonly type: 'openMenu' } & AxisTarget)
  | { readonly type: 'move'; readonly to: Address; readonly extend: boolean }
  | { readonly type: 'edit'; readonly initial?: string }
  | { readonly type: 'cancel' }
  | { readonly type: 'clear' }
  | { readonly type: 'none' };

/** Commands whose key press must not reach the browser. */
export const preventsDefault = (command: GridCommand): boolean =>
  command.type !== 'none' && command.type !== 'cancel';

export function resolveGridKey(event: KeyInput, ctx: NavigationContext): GridCommand {
  const mod = event.metaKey || event.ctrlKey;
  const key = event.key.toLowerCase();
  const { active, selection } = ctx;
  if (mod && (key === 'd' || key === 'r'))
    return {
      type: 'fill',
      target: selection,
      source:
        key === 'd'
          ? CellRange.of(selection.start, Address.unsafe(selection.start.row, selection.end.col))
          : CellRange.of(selection.start, Address.unsafe(selection.end.row, selection.start.col)),
    };
  if (mod && key === 'z') return { type: event.shiftKey ? 'redo' : 'undo' };
  if (mod && key === 'y') return { type: 'redo' };
  if (mod && key === 'a') return { type: 'selectAll' };
  if (event.key === ' ' && (event.shiftKey || mod))
    return mod
      ? { type: 'selectAxis', axis: 'columns', index: active.col }
      : { type: 'selectAxis', axis: 'rows', index: active.row };
  if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))
    return ctx.selectionKind === 'rows'
      ? { type: 'openMenu', axis: 'rows', index: active.row }
      : { type: 'openMenu', axis: 'columns', index: active.col };
  let row: number = active.row;
  let col: number = active.col;
  switch (event.key) {
    case 'ArrowDown':
      row = mod ? ctx.rows - 1 : row + 1;
      break;
    case 'ArrowUp':
      row = mod ? 0 : row - 1;
      break;
    case 'ArrowRight':
      col = mod ? ctx.columns - 1 : col + 1;
      break;
    case 'ArrowLeft':
      col = mod ? 0 : col - 1;
      break;
    case 'Tab':
      col += event.shiftKey ? -1 : 1;
      break;
    case 'Home':
      col = 0;
      if (mod) row = 0;
      break;
    case 'End':
      col = ctx.columns - 1;
      if (mod) row = ctx.rows - 1;
      break;
    case 'PageDown':
      row += ctx.pageRows;
      break;
    case 'PageUp':
      row -= ctx.pageRows;
      break;
    case 'Enter':
    case 'F2':
      return { type: 'edit' };
    case 'Escape':
      return { type: 'cancel' };
    case 'Delete':
    case 'Backspace':
      return { type: 'clear' };
    default:
      return !mod && !event.altKey && event.key.length === 1
        ? { type: 'edit', initial: event.key }
        : { type: 'none' };
  }
  return {
    type: 'move',
    to: Address.clamp(row, col, ctx),
    extend: event.shiftKey && event.key !== 'Tab',
  };
}
