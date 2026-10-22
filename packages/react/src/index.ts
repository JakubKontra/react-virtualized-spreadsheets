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
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import { useSheetGestures } from './gestures';
import { useRangeDrag } from './range-drag';
import { useFormulaEditor } from './formula-editor';
import {
  CLIPBOARD_MIME,
  contains,
  normalizeRange,
  type SelectionSummary,
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
  const draft = state.draft ?? '';
  const setDraft = (value: string) => store.setDraft(value);
  const viewState = store.view?.getSnapshot();
  const rowSize = useCallback(
    (index: number) =>
      store.rows ? (store.view?.rows.size(index, rowHeight) ?? rowHeight) : rowHeight,
    [store, rowHeight, store.view?.rows],
  );
  const colSize = useCallback(
    (index: number) => {
      const canonical = store.view?.columns.canonicalAt(index) ?? index;
      return store.view?.columns.size(index, columnWidth(canonical)) ?? columnWidth(index);
    },
    [store, columnWidth, viewState?.columns],
  );
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() =>
      setViewportSize({ width: element.clientWidth, height: element.clientHeight }),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [scrollRef]);
  function fitting(count: number, size: (index: number) => number, available: number) {
    let total = 0,
      index = 0;
    for (; index < count; index++) {
      total += size(index);
      if (total > available) break;
    }
    return index;
  }
  const frozenRows = fitting(
    Math.min(viewState?.frozen?.rows ?? 0, store.rows),
    rowSize,
    viewportSize.height - columnHeaderHeight - 80,
  );
  const frozenColumns = fitting(
    Math.min(viewState?.frozen?.columns ?? 0, store.columns),
    colSize,
    viewportSize.width - rowHeaderWidth - 100,
  );
  const frozenHeight = Array.from({ length: frozenRows }, (_, i) => rowSize(i)).reduce(
    (a, b) => a + b,
    0,
  );
  const frozenWidth = Array.from({ length: frozenColumns }, (_, i) => colSize(i)).reduce(
    (a, b) => a + b,
    0,
  );
  const rowExtractor = useCallback(
    (range: Parameters<typeof defaultRangeExtractor>[0]) =>
      [
        ...new Set([
          ...Array.from({ length: frozenRows }, (_, i) => i),
          ...defaultRangeExtractor(range),
        ]),
      ].sort((a, b) => a - b),
    [frozenRows],
  );
  const colExtractor = useCallback(
    (range: Parameters<typeof defaultRangeExtractor>[0]) =>
      [
        ...new Set([
          ...Array.from({ length: frozenColumns }, (_, i) => i),
          ...defaultRangeExtractor(range),
        ]),
      ].sort((a, b) => a - b),
    [frozenColumns],
  );
  const rows = useVirtualizer({
    count: store.rows,
    rangeExtractor: rowExtractor,
    getScrollElement: () => scrollRef.current,
    estimateSize: rowSize,
    overscan: 6,
    paddingStart: columnHeaderHeight,
    scrollPaddingStart: columnHeaderHeight + frozenHeight,
  });
  const columns = useVirtualizer({
    horizontal: true,
    count: store.columns,
    rangeExtractor: colExtractor,
    getScrollElement: () => scrollRef.current,
    estimateSize: colSize,
    overscan: 2,
    paddingStart: rowHeaderWidth,
    scrollPaddingStart: rowHeaderWidth + frozenWidth,
  });
  const virtualRows = rows.getVirtualItems();
  const virtualColumns = columns.getVirtualItems();
  const rowRuns = JSON.stringify(runs(virtualRows.map((r) => r.index))),
    colRuns = JSON.stringify(runs(virtualColumns.map((c) => c.index)));
  useEffect(() => {
    const rr = JSON.parse(rowRuns) as [number, number][],
      cc = JSON.parse(colRuns) as [number, number][];
    store.setViewports(
      rr.flatMap(([r0, r1]) =>
        cc.map(([c0, c1]) => ({ start: { row: r0, col: c0 }, end: { row: r1, col: c1 } })),
      ),
    );
  }, [store, rowRuns, colRuns, state.querying, state.revision]);
  useEffect(() => {
    rows.measure();
  }, [rows, rowSize]);
  useEffect(() => {
    columns.measure();
  }, [columns, colSize]);
  const selection = normalizeRange(state.selection);
  const cellId = (address: Address) => `${prefix}-cell-${address.row}-${address.col}`;
  const report = (promise: Promise<unknown>) => {
    void promise.catch((error) => store.setError(error));
  };
  const focus = () => scrollRef.current?.focus({ preventScroll: true });
  function scrollToCell(address: Address) {
    store.assertAddress(address);
    if (address.row >= frozenRows) rows.scrollToIndex(address.row, { align: 'auto' });
    if (address.col >= frozenColumns) columns.scrollToIndex(address.col, { align: 'auto' });
  }
  function select(address: Address, extend = false) {
    store.assertAddress(address);
    if (store.getSnapshot().editing) {
      void commitEdit().then((ok) => {
        if (ok) {
          store.select(address, extend);
          scrollToCell(address);
        }
      });
      return;
    }
    store.select(address, extend);
    scrollToCell(address);
  }
  function startEdit(initial?: string, address = state.active) {
    store.beginEdit(address, initial);
  }
  const committing = useRef<Promise<boolean> | null>(null);
  function commitEdit(
    text = store.getSnapshot().draft ?? '',
    move = false,
    restoreFocus = true,
  ): Promise<boolean> {
    if (committing.current) return committing.current;
    const snapshot = store.getSnapshot();
    if (!snapshot.editing && text === '') return Promise.resolve(true);
    const address = snapshot.editing ?? snapshot.active;
    committing.current = (async () => {
      const input = store.parseInput(text, address);
      try {
        if (String(store.readCell(address).input ?? '') !== text) {
          if (['loading', 'calculating'].includes(store.readCell(address).status))
            await store.ensureRange({ start: address, end: address });
          if (store.source.mode === 'remote' && !store.view) {
            if (input !== null && (typeof input !== 'string' || !input.startsWith('=')))
              throw new Error('Calculated columns require a formula starting with =');
            await store.setColumnFormula(
              address.col,
              input === null ? null : shiftFormula(input as string, -address.row, 0),
            );
          } else await store.edit([{ ...address, input }]);
        } else store.cancelEdit();
        if (move) {
          const next = { row: Math.min(store.rows - 1, address.row + 1), col: address.col };
          store.select(next);
          scrollToCell(next);
        }
        if (restoreFocus) focus();
        return true;
      } catch (error) {
        store.setError(error);
        return false;
      }
    })();
    void committing.current.finally(() => {
      committing.current = null;
    });
    return committing.current;
  }
  function axisItem(axis: 'rows' | 'columns', index: number) {
    if (axis === 'columns') {
      let start = rowHeaderWidth;
      for (let c = 0; c < index; c++) start += colSize(c);
      return { index, start, size: colSize(index), end: start + colSize(index) };
    }
    let start = columnHeaderHeight + index * rowHeight;
    for (const [key, size] of Object.entries(viewState?.rows.sizes ?? {})) {
      const position = store.view!.rows.visibleIndex(Number(key));
      if (position >= 0 && position < index) start += size - rowHeight;
    }
    return { index, start, size: rowSize(index), end: start + rowSize(index) };
  }
  const displayRow = (index: number, start: number) =>
    start + (index < frozenRows ? (rows.scrollOffset ?? 0) : 0);
  const displayColumn = (index: number, start: number) =>
    start + (index < frozenColumns ? (columns.scrollOffset ?? 0) : 0);
  const offset = (axis: 'rows' | 'columns', local: number) =>
    local +
    ((
      axis === 'rows'
        ? local < columnHeaderHeight + frozenHeight
        : local < rowHeaderWidth + frozenWidth
    )
      ? 0
      : ((axis === 'rows' ? scrollRef.current?.scrollTop : scrollRef.current?.scrollLeft) ?? 0));
  const rangeDrag = useRangeDrag({
    store,
    scrollRef,
    point: (x, y) => {
      const rect = scrollRef.current?.getBoundingClientRect();
      if (!rect || !store.rows) return;
      const row = rows.getVirtualItemForOffset(
        offset('rows', Math.max(columnHeaderHeight, Math.min(rect.height - 1, y - rect.top))),
      )?.index;
      const col = columns.getVirtualItemForOffset(
        offset('columns', Math.max(rowHeaderWidth, Math.min(rect.width - 1, x - rect.left))),
      )?.index;
      return row === undefined || col === undefined ? undefined : { row, col };
    },
  });
  const formula = useFormulaEditor(store, draft, state.editing);
  const summary = useSelectionSummary(store, state.selection, state.revision, state.querying);
  const gestures = useSheetGestures({
    store,
    scrollRef,
    rowHeaderWidth,
    columnHeaderHeight,
    commit: () => commitEdit(),
    item: axisItem,
    offset,
    display: (axis, index, start) =>
      axis === 'rows' ? displayRow(index, start) : displayColumn(index, start),
    itemAt: (axis, offset) => (axis === 'rows' ? rows : columns).getVirtualItemForOffset(offset),
  });
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget || event.nativeEvent.isComposing) return;
    if (!store.rows || state.querying) return;
    const mod = event.metaKey || event.ctrlKey;
    const current = state.active;
    if (mod && ['d', 'r'].includes(event.key.toLowerCase())) {
      event.preventDefault();
      const source =
        event.key.toLowerCase() === 'd'
          ? { start: selection.start, end: { row: selection.start.row, col: selection.end.col } }
          : { start: selection.start, end: { row: selection.end.row, col: selection.start.col } };
      report(store.fill(selection, source));
      return;
    }
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
      store.selectAll();
      return;
    }
    if (event.key === ' ' && (event.shiftKey || mod)) {
      event.preventDefault();
      store.selectAxis(mod ? 'columns' : 'rows', mod ? current.col : current.row);
      return;
    }
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault();
      const rect = scrollRef.current?.getBoundingClientRect();
      if (rect)
        void gestures.openMenu(
          state.selectionKind === 'rows' ? 'rows' : 'columns',
          state.selectionKind === 'rows' ? current.row : current.col,
          rect.left + rowHeaderWidth,
          rect.top + columnHeaderHeight,
        );
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
      virtualRows.some((row) => row.index === state.active.row) &&
      virtualColumns.some((col) => col.index === state.active.col)
        ? cellId(state.active)
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
      'data-address': store.labelAddress(address),
      style: formula.referenceColor(address)
        ? { boxShadow: `inset 0 0 0 2px ${formula.referenceColor(address)}` }
        : rangeDrag.preview && contains(rangeDrag.preview, address)
          ? { boxShadow: 'inset 0 0 0 1px #087f5b' }
          : undefined,
      onPointerDown(event) {
        if (event.button !== 0) return;
        event.preventDefault();
        if (state.querying) return;
        const pick = formula.pick();
        if (pick) {
          pick.update({ start: address, end: address });
          rangeDrag.start(
            event,
            'reference',
            { start: address, end: address },
            pick.update,
            pick.cancel,
          );
          return;
        }
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
        store.select(address, event.shiftKey);
        gestures.startSelection(event);
        focus();
      },
      onDoubleClick() {
        startEdit(undefined, address);
      },
    };
  }
  type EditorProps = InputHTMLAttributes<HTMLInputElement> & { 'data-sheet-editor': string };
  const isOtherEditor = (element: EventTarget | null) =>
    element instanceof HTMLElement && element.dataset.sheetEditor === prefix;
  const editorProps: EditorProps = {
    'data-sheet-editor': prefix,
    'aria-label': state.editing ? `Edit ${store.labelAddress(state.editing)}` : 'Cell editor',
    value: draft,
    disabled: state.pending,
    onSelect: formula.track,
    onFocus: formula.track,
    onBlur(event) {
      if (!isOtherEditor(event.relatedTarget)) void commitEdit(undefined, false, false);
    },
    onChange: (event) => {
      setDraft(event.target.value);
      formula.track(event);
    },
    onKeyDown(event) {
      event.stopPropagation();
      if (event.nativeEvent.isComposing) return;
      if (formula.onKeyDown(event)) return;
      if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        const input = event.currentTarget,
          position = event.key === 'Home' ? 0 : input.value.length;
        if (input.type !== 'date')
          input.setSelectionRange(
            event.shiftKey ? Math.min(input.selectionStart ?? 0, position) : position,
            event.shiftKey ? Math.max(input.selectionEnd ?? 0, position) : position,
          );
        formula.track(event);
        return;
      }
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
  const activeCell = useCell(store, state.active.row, state.active.col);
  const formulaBarProps: EditorProps = {
    'data-sheet-editor': prefix,
    'aria-label': 'Formula bar',
    value: state.editing ? draft : String(activeCell.input ?? ''),
    disabled:
      !store.source.isEditable(state.active) ||
      state.pending ||
      (!state.editing && (activeCell.status === 'loading' || activeCell.status === 'calculating')),
    onSelect: formula.track,
    onFocus(event) {
      formula.track(event);
      store.beginEdit(store.getSnapshot().active, undefined, 'bar');
    },
    onChange(event) {
      store.setDraft(event.target.value);
      formula.track(event);
    },
    onBlur(event) {
      if (!isOtherEditor(event.relatedTarget)) void commitEdit(undefined, false, false);
    },
    onKeyDown(event) {
      if (event.nativeEvent.isComposing) return;
      if (formula.onKeyDown(event)) return;
      if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        const input = event.currentTarget,
          position = event.key === 'Home' ? 0 : input.value.length;
        if (input.type !== 'date')
          input.setSelectionRange(
            event.shiftKey ? Math.min(input.selectionStart ?? 0, position) : position,
            event.shiftKey ? Math.max(input.selectionEnd ?? 0, position) : position,
          );
        formula.track(event);
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        void commitEdit();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        store.cancelEdit();
        focus();
      }
    },
  };
  function cellRect(address: Address) {
    const r = axisItem('rows', address.row);
    const c = axisItem('columns', address.col);
    return {
      left: displayColumn(address.col, c.start),
      top: displayRow(address.row, r.start),
      width: c.size,
      height: r.size,
    };
  }

  return {
    state,
    formula,
    summary,
    frozenRows,
    frozenColumns,
    displayRow,
    displayColumn,
    fillPreview: rangeDrag.preview,
    fillHandleProps: {
      'aria-label': 'Autofill selection',
      onPointerDown: (event: import('react').PointerEvent) => {
        if (!state.editing && !state.pending && !state.querying)
          rangeDrag.start(event, 'fill', selection);
      },
      onKeyDown: (event: KeyboardEvent) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
          event.preventDefault();
          const end = { ...selection.end };
          if (event.key === 'ArrowDown') end.row = Math.min(store.rows - 1, end.row + 1);
          else end.col = Math.min(store.columns - 1, end.col + 1);
          report(store.fill({ start: selection.start, end }));
        }
      },
    },
    gestures,
    selection,
    virtualRows,
    virtualColumns,
    totalHeight: rows.getTotalSize(),
    totalWidth: columns.getTotalSize(),
    gridProps,
    getCellProps,
    editorProps,
    formulaBarProps,
    draft,
    setDraft,
    startEdit,
    commitEdit,
    select,
    scrollToCell,
    cellRect,
  };
}

function runs(indices: number[]) {
  const result: [number, number][] = [];
  for (const index of indices) {
    const last = result.at(-1);
    if (last && last[1] + 1 === index) last[1] = index;
    else result.push([index, index]);
  }
  return result;
}
export function useSelectionSummary(
  store: SpreadsheetStore,
  range: import('@sheet/core').CellRange,
  revision: number,
  querying = false,
) {
  const [state, setState] = useState<{
    value: SelectionSummary | null;
    loading: boolean;
    error: string | null;
  }>({ value: null, loading: false, error: null });
  const { start, end } = range;
  useEffect(() => {
    const controller = new AbortController();
    if (!store.source.getSummary || !store.rows || querying) {
      setState({ value: null, loading: false, error: null });
      return;
    }
    setState({ value: null, loading: true, error: null });
    const timer = setTimeout(() => {
      void store.source.getSummary!(range, controller.signal)
        .then((value) => {
          if (!controller.signal.aborted) setState({ value, loading: false, error: null });
        })
        .catch((error) => {
          if (!controller.signal.aborted)
            setState({ value: null, loading: false, error: String(error) });
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [store, start.row, start.col, end.row, end.col, revision, querying]);
  return state;
}
