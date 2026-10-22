import type { ClipboardEvent, KeyboardEvent, RefObject } from 'react';
import {
  assertNever,
  CLIPBOARD_MIME,
  type CellRange,
  type SpreadsheetState,
  type SpreadsheetStore,
} from '@sheet/core';
import { preventsDefault, resolveGridKey, type GridCommand } from '../internal/navigation';
import type { EditSession, GridProps, Navigation, SheetGestures } from '../types';

export interface UseGridPropsOptions {
  readonly store: SpreadsheetStore;
  readonly state: SpreadsheetState;
  readonly scrollRef: RefObject<HTMLElement | null>;
  readonly edit: EditSession;
  readonly navigation: Navigation;
  readonly gestures: SheetGestures;
  readonly rowHeaderWidth: number;
  readonly columnHeaderHeight: number;
  /** Normalized selection. */
  readonly selection: CellRange;
  readonly pageRows: () => number;
  /** Id of the active cell element, when it is rendered. */
  readonly activeDescendant: string | undefined;
  report(promise: Promise<unknown>): void;
}

/** Props for the focusable grid element: keyboard navigation and clipboard. */
export function useGridProps(options: UseGridPropsOptions): GridProps {
  const { store, state, edit, navigation, gestures, report } = options;
  function execute(command: GridCommand) {
    switch (command.type) {
      case 'fill':
        return report(store.fill(command.target, command.source));
      case 'undo':
        return report(store.undo());
      case 'redo':
        return report(store.redo());
      case 'selectAll':
        return store.selectAll();
      case 'selectAxis':
        return command.axis === 'rows'
          ? store.selectAxis('rows', command.index)
          : store.selectAxis('columns', command.index);
      case 'openMenu': {
        const rect = options.scrollRef.current?.getBoundingClientRect();
        if (!rect) return;
        const x = rect.left + options.rowHeaderWidth;
        const y = rect.top + options.columnHeaderHeight;
        void (command.axis === 'rows'
          ? gestures.openMenu('rows', command.index, x, y)
          : gestures.openMenu('columns', command.index, x, y));
        return;
      }
      case 'move':
        return navigation.select(command.to, { extend: command.extend });
      case 'edit':
        return edit.start({ initial: command.initial });
      case 'cancel':
        return edit.cancel();
      case 'clear':
        return report(store.clearSelection());
      case 'none':
        return;
      default:
        return assertNever(command);
    }
  }
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget || event.nativeEvent.isComposing) return;
    if (!store.rows || state.querying) return;
    const command = resolveGridKey(event, {
      active: state.active,
      selection: options.selection,
      selectionKind: state.selectionKind,
      rows: store.rows,
      columns: store.columns,
      pageRows: options.pageRows(),
    });
    if (preventsDefault(command)) event.preventDefault();
    execute(command);
  };
  return {
    role: 'grid',
    tabIndex: 0,
    'aria-label': 'Spreadsheet',
    'aria-rowcount': store.rows,
    'aria-colcount': store.columns,
    'aria-multiselectable': true,
    'aria-activedescendant': options.activeDescendant,
    onKeyDown,
    onCopy(event: ClipboardEvent<HTMLElement>) {
      if (event.target !== event.currentTarget) return;
      try {
        const text = store.copy();
        event.clipboardData.setData('text/plain', text);
        event.clipboardData.setData(CLIPBOARD_MIME, store.getClipboardToken());
        event.preventDefault();
      } catch (error) {
        store.setError(error);
      }
    },
    onPaste(event: ClipboardEvent<HTMLElement>) {
      if (event.target !== event.currentTarget) return;
      const token = event.clipboardData.getData(CLIPBOARD_MIME);
      event.preventDefault();
      report(
        store.paste(
          event.clipboardData.getData('text/plain'),
          !!token && token === store.getClipboardToken(),
        ),
      );
    },
  };
}
