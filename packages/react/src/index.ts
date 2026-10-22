import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ClipboardEvent,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  CLIPBOARD_MIME,
  addressLabel,
  contains,
  normalizeRange,
  parseInput,
  shiftFormula,
  type Address,
  type SpreadsheetStore,
} from '@sheet/core';

export function useCell(store: SpreadsheetStore, row: number, col: number) {
  const subscribe = useCallback(
    (listener: () => void) => store.subscribeCell({ row, col }, listener),
    [store, row, col],
  );
  const read = useCallback(() => store.readCell({ row, col }), [store, row, col]);
  return useSyncExternalStore(subscribe, read, read);
}
export function useSpreadsheetState(store: SpreadsheetStore) {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
export interface UseSpreadsheetOptions {
  store: SpreadsheetStore;
  scrollRef: RefObject<HTMLElement | null>;
  rowHeight?: number;
  columnWidth?: (col: number) => number;
  rowHeaderWidth?: number;
  columnHeaderHeight?: number;
}
const defaultWidth = () => 120;
export function useSpreadsheet({
  store,
  scrollRef,
  rowHeight = 32,
  columnWidth = defaultWidth,
  rowHeaderWidth = 52,
  columnHeaderHeight = 34,
}: UseSpreadsheetOptions) {
  const state = useSpreadsheetState(store);
  const prefix = useId().replaceAll(':', '');
  const dragging = useRef(false);
  const [draft, setDraft] = useState('');
  const rows = useVirtualizer({
    count: store.rows,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 6,
    paddingStart: columnHeaderHeight,
    scrollPaddingStart: columnHeaderHeight,
  });
  const columns = useVirtualizer({
    horizontal: true,
    count: store.columns,
    getScrollElement: () => scrollRef.current,
    estimateSize: columnWidth,
    overscan: 2,
    paddingStart: rowHeaderWidth,
    scrollPaddingStart: rowHeaderWidth,
  });
  const virtualRows = rows.getVirtualItems();
  const virtualColumns = columns.getVirtualItems();
  const r0 = virtualRows[0]?.index;
  const r1 = virtualRows.at(-1)?.index;
  const c0 = virtualColumns[0]?.index;
  const c1 = virtualColumns.at(-1)?.index;
  useEffect(() => {
    if (r0 !== undefined && r1 !== undefined && c0 !== undefined && c1 !== undefined)
      store.setViewport({ start: { row: r0, col: c0 }, end: { row: r1, col: c1 } });
  }, [store, r0, r1, c0, c1]);
  useEffect(() => {
    const release = () => {
      dragging.current = false;
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('blur', release);
    };
  }, []);
  useEffect(() => {
    columns.measure();
  }, [columns, columnWidth]);
  const selection = normalizeRange(state.selection);
  const cellId = (address: Address) => `${prefix}-cell-${address.row}-${address.col}`;
  const report = (promise: Promise<unknown>) => {
    void promise.catch((error) => store.setError(error));
  };
  const focus = () => scrollRef.current?.focus({ preventScroll: true });
  function scrollToCell(address: Address) {
    store.assertAddress(address);
    rows.scrollToIndex(address.row, { align: 'auto' });
    columns.scrollToIndex(address.col, { align: 'auto' });
  }
  function select(address: Address, extend = false) {
    store.select(address, extend);
    scrollToCell(address);
  }
  function startEdit(initial?: string, address = state.selection.end) {
    store.beginEdit(address);
    if (store.getSnapshot().editing)
      setDraft(initial ?? String(store.readCell(address).input ?? ''));
  }
  async function commitEdit(text = draft, move = false) {
    const address = store.getSnapshot().editing ?? store.getSnapshot().selection.end;
    const input = parseInput(text);
    try {
      if (store.source.mode === 'remote') {
        if (input !== null && (typeof input !== 'string' || !input.startsWith('=')))
          throw new Error('Calculated columns require a formula starting with =');
        await store.setColumnFormula(
          address.col,
          input === null ? null : shiftFormula(input as string, -address.row, 0),
        );
      } else await store.edit([{ ...address, input }]);
      if (move) select({ row: Math.min(store.rows - 1, address.row + 1), col: address.col });
      focus();
    } catch (error) {
      store.setError(error);
    }
  }
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget || event.nativeEvent.isComposing) return;
    const mod = event.metaKey || event.ctrlKey;
    const current = state.selection.end;
    if (mod && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      report(event.shiftKey ? store.redo() : store.undo());
      return;
    }
    if (mod && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      report(store.redo());
      return;
    }
    if (mod && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      store.select({ row: 0, col: 0 });
      store.select({ row: store.rows - 1, col: store.columns - 1 }, true);
      return;
    }
    let { row, col } = current;
    switch (event.key) {
      case 'ArrowDown':
        row = mod ? store.rows - 1 : row + 1;
        break;
      case 'ArrowUp':
        row = mod ? 0 : row - 1;
        break;
      case 'ArrowRight':
        col = mod ? store.columns - 1 : col + 1;
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
        col = store.columns - 1;
        if (mod) row = store.rows - 1;
        break;
      case 'PageDown':
        row += Math.max(1, Math.floor((scrollRef.current?.clientHeight ?? 320) / rowHeight) - 1);
        break;
      case 'PageUp':
        row -= Math.max(1, Math.floor((scrollRef.current?.clientHeight ?? 320) / rowHeight) - 1);
        break;
      case 'Enter':
      case 'F2':
        event.preventDefault();
        startEdit();
        return;
      case 'Escape':
        store.cancelEdit();
        return;
      case 'Delete':
      case 'Backspace':
        event.preventDefault();
        report(store.clearSelection());
        return;
      default:
        if (!mod && !event.altKey && event.key.length === 1) {
          event.preventDefault();
          startEdit(event.key);
        }
        return;
    }
    event.preventDefault();
    select(
      {
        row: Math.max(0, Math.min(store.rows - 1, row)),
        col: Math.max(0, Math.min(store.columns - 1, col)),
      },
      event.shiftKey && event.key !== 'Tab',
    );
  };
  const gridProps: HTMLAttributes<HTMLElement> & {
    'aria-rowcount': number;
    'aria-colcount': number;
  } = {
    role: 'grid',
    tabIndex: 0,
    'aria-label': 'Spreadsheet',
    'aria-rowcount': store.rows,
    'aria-colcount': store.columns,
    'aria-multiselectable': true,
    'aria-activedescendant':
      virtualRows.some((row) => row.index === state.selection.end.row) &&
      virtualColumns.some((col) => col.index === state.selection.end.col)
        ? cellId(state.selection.end)
        : undefined,
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
  function getCellProps(
    address: Address,
  ): HTMLAttributes<HTMLElement> & { 'data-address': string } {
    return {
      id: cellId(address),
      role: 'gridcell',
      'aria-rowindex': address.row + 1,
      'aria-colindex': address.col + 1,
      'aria-selected': contains(selection, address),
      'aria-readonly': !store.source.isEditable(address),
      'data-address': addressLabel(address),
      onPointerDown(event) {
        if (event.button !== 0) return;
        event.preventDefault();
        if (store.getSnapshot().editing) {
          const extend = event.shiftKey;
          void commitEdit().then(() => {
            if (!store.getSnapshot().editing) {
              store.select(address, extend);
              focus();
            }
          });
          return;
        }
        dragging.current = true;
        store.select(address, event.shiftKey);
        focus();
      },
      onPointerEnter() {
        if (dragging.current) store.select(address, true);
      },
      onDoubleClick() {
        startEdit(undefined, address);
      },
    };
  }
  const editorProps: InputHTMLAttributes<HTMLInputElement> = {
    'aria-label': state.editing ? `Edit ${addressLabel(state.editing)}` : 'Cell editor',
    value: draft,
    disabled: state.pending,
    onChange: (event) => setDraft(event.target.value),
    onKeyDown(event) {
      event.stopPropagation();
      if (event.nativeEvent.isComposing) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        void commitEdit(draft, true);
      } else if (event.key === 'Tab') {
        event.preventDefault();
        const address = state.editing!;
        void commitEdit().then(() => {
          if (!store.getSnapshot().editing)
            select({
              row: address.row,
              col: Math.max(
                0,
                Math.min(store.columns - 1, address.col + (event.shiftKey ? -1 : 1)),
              ),
            });
        });
      } else if (event.key === 'Escape') {
        event.preventDefault();
        store.cancelEdit();
        focus();
      }
    },
  };
  function cellRect(address: Address) {
    let left = rowHeaderWidth;
    for (let col = 0; col < address.col; col++) left += columnWidth(col);
    return {
      left,
      top: columnHeaderHeight + address.row * rowHeight,
      width: columnWidth(address.col),
      height: rowHeight,
    };
  }
  return {
    state,
    selection,
    virtualRows,
    virtualColumns,
    totalHeight: rows.getTotalSize(),
    totalWidth: columns.getTotalSize(),
    gridProps,
    getCellProps,
    editorProps,
    draft,
    setDraft,
    startEdit,
    commitEdit,
    select,
    scrollToCell,
    cellRect,
  };
}
