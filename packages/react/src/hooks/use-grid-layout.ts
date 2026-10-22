import { useCallback, useEffect, useRef, type RefObject } from 'react';
import {
  defaultRangeExtractor,
  useVirtualizer,
  type Range,
  type VirtualItem,
} from '@tanstack/react-virtual';
import {
  Address,
  CanonicalCol,
  CanonicalRow,
  ColIndex,
  RowIndex,
  type Axis,
  type SpreadsheetState,
  type SpreadsheetStore,
} from '@sheet/core';
import {
  fitting,
  leadingSize,
  withFrozen,
  type AxisItem,
  type CellRect,
} from '../internal/geometry';
import { runs, runsEqual, viewportsFromRuns, type Run } from '../internal/runs';
import type { GridLayout, VirtualColumn, VirtualRow } from '../types';
import { useViewportSize } from './use-viewport-size';

export interface UseGridLayoutOptions {
  readonly store: SpreadsheetStore;
  readonly state: SpreadsheetState;
  readonly scrollRef: RefObject<HTMLElement | null>;
  readonly rowHeight: number;
  readonly columnWidth: (col: CanonicalCol) => number;
  readonly rowHeaderWidth: number;
  readonly columnHeaderHeight: number;
}
/** Layout plus the geometry queries the interaction hooks need. */
export interface GridGeometry extends GridLayout {
  item(axis: Axis, index: number): AxisItem;
  itemAt(axis: Axis, offset: number): AxisItem | undefined;
  offset(axis: Axis, local: number): number;
  display(axis: Axis, index: number, start: number): number;
  /** Cell under a client point, clamped into the scroll container. */
  pointToCell(x: number, y: number): Address | undefined;
  scrollToCell(address: Address): void;
  /** Visible rows per page, for PageUp/PageDown. */
  pageRows(): number;
}

/** TanStack guarantees `0 <= index < count`, so its items are valid positions of their axis. */
const brandRows = (items: readonly VirtualItem[]): VirtualRow[] =>
  items.map(({ key, index, start, size, end }) => ({
    key,
    index: RowIndex.unsafe(index),
    start,
    size,
    end,
  }));
const brandColumns = (items: readonly VirtualItem[]): VirtualColumn[] =>
  items.map(({ key, index, start, size, end }) => ({
    key,
    index: ColIndex.unsafe(index),
    start,
    size,
    end,
  }));

/** Keeps the previous value while it is structurally equal, so effects do not re-run. */
function useStructural<T>(value: T, equal: (a: T, b: T) => boolean): T {
  const ref = useRef(value);
  if (!equal(ref.current, value)) ref.current = value;
  return ref.current;
}

export function useGridLayout({
  store,
  state,
  scrollRef,
  rowHeight,
  columnWidth,
  rowHeaderWidth,
  columnHeaderHeight,
}: UseGridLayoutOptions): GridGeometry {
  const view = store.view;
  const viewState = view?.getSnapshot();
  const rowAxis = view?.rows;
  const columnAxis = viewState?.columns;
  const rowSize = useCallback(
    (index: number) =>
      store.rows && rowAxis ? rowAxis.size(RowIndex.unsafe(index), rowHeight) : rowHeight,
    [store, rowHeight, rowAxis],
  );
  const colSize = useCallback(
    (index: number) => {
      const col = ColIndex.unsafe(index);
      if (!view) return columnWidth(CanonicalCol.unsafe(index));
      return view.columns.size(col, columnWidth(view.columns.canonicalAt(col)));
    },
    // The view's column axis changes identity whenever sizes or order change.
    [store, columnWidth, view, columnAxis],
  );
  const viewport = useViewportSize(scrollRef);
  const frozenRows = fitting(
    Math.min(viewState?.frozen?.rows ?? 0, store.rows),
    rowSize,
    viewport.height - columnHeaderHeight - 80,
  );
  const frozenColumns = fitting(
    Math.min(viewState?.frozen?.columns ?? 0, store.columns),
    colSize,
    viewport.width - rowHeaderWidth - 100,
  );
  const frozenHeight = leadingSize(frozenRows, rowSize);
  const frozenWidth = leadingSize(frozenColumns, colSize);
  const rowExtractor = useCallback(
    (range: Range) => withFrozen(frozenRows, defaultRangeExtractor(range)),
    [frozenRows],
  );
  const colExtractor = useCallback(
    (range: Range) => withFrozen(frozenColumns, defaultRangeExtractor(range)),
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
  const virtualRows = brandRows(rows.getVirtualItems());
  const virtualColumns = brandColumns(columns.getVirtualItems());
  const rowRuns = useStructural<readonly Run[]>(runs(virtualRows.map((r) => r.index)), runsEqual);
  const colRuns = useStructural<readonly Run[]>(
    runs(virtualColumns.map((c) => c.index)),
    runsEqual,
  );
  useEffect(() => {
    store.setViewports(viewportsFromRuns(rowRuns, colRuns));
  }, [store, rowRuns, colRuns, state.querying, state.revision]);
  useEffect(() => {
    rows.measure();
  }, [rows, rowSize]);
  useEffect(() => {
    columns.measure();
  }, [columns, colSize]);

  const rowSizes = viewState?.rows.sizes;
  const item = (axis: Axis, index: number): AxisItem => {
    if (axis === 'columns') {
      const start = rowHeaderWidth + leadingSize(index, colSize);
      const size = colSize(index);
      return { index, start, size, end: start + size };
    }
    // Rows are uniform except for explicitly resized ones, so avoid summing every row.
    let start = columnHeaderHeight + index * rowHeight;
    if (view)
      for (const [key, size] of Object.entries(rowSizes ?? {})) {
        if (size === undefined) continue;
        const position = view.rows.visibleIndex(CanonicalRow.unsafe(Number(key)));
        if (position !== undefined && position < index) start += size - rowHeight;
      }
    const size = rowSize(index);
    return { index, start, size, end: start + size };
  };
  const displayRow = (index: number, start: number) =>
    start + (index < frozenRows ? (rows.scrollOffset ?? 0) : 0);
  const displayColumn = (index: number, start: number) =>
    start + (index < frozenColumns ? (columns.scrollOffset ?? 0) : 0);
  const display = (axis: Axis, index: number, start: number) =>
    axis === 'rows' ? displayRow(index, start) : displayColumn(index, start);
  const offset = (axis: Axis, local: number) => {
    const frozen =
      axis === 'rows'
        ? local < columnHeaderHeight + frozenHeight
        : local < rowHeaderWidth + frozenWidth;
    const element = scrollRef.current;
    return (
      local + (frozen ? 0 : ((axis === 'rows' ? element?.scrollTop : element?.scrollLeft) ?? 0))
    );
  };
  const itemAt = (axis: Axis, position: number) =>
    (axis === 'rows' ? rows : columns).getVirtualItemForOffset(position);
  const pointToCell = (x: number, y: number) => {
    const rect = scrollRef.current?.getBoundingClientRect();
    if (!rect || !store.rows) return undefined;
    const row = itemAt(
      'rows',
      offset('rows', Math.max(columnHeaderHeight, Math.min(rect.height - 1, y - rect.top))),
    )?.index;
    const col = itemAt(
      'columns',
      offset('columns', Math.max(rowHeaderWidth, Math.min(rect.width - 1, x - rect.left))),
    )?.index;
    return row === undefined || col === undefined ? undefined : Address.unsafe(row, col);
  };
  const cellRect = (address: Address): CellRect => {
    const r = item('rows', address.row);
    const c = item('columns', address.col);
    return {
      left: displayColumn(address.col, c.start),
      top: displayRow(address.row, r.start),
      width: c.size,
      height: r.size,
    };
  };
  const scrollToCell = (address: Address) => {
    store.assertAddress(address);
    if (address.row >= frozenRows) rows.scrollToIndex(address.row, { align: 'auto' });
    if (address.col >= frozenColumns) columns.scrollToIndex(address.col, { align: 'auto' });
  };
  const pageRows = () =>
    Math.max(1, Math.floor((scrollRef.current?.clientHeight ?? 320) / rowHeight) - 1);
  return {
    virtualRows,
    virtualColumns,
    totalWidth: columns.getTotalSize(),
    totalHeight: rows.getTotalSize(),
    frozenRows,
    frozenColumns,
    displayRow,
    displayColumn,
    cellRect,
    item,
    itemAt,
    offset,
    display,
    pointToCell,
    scrollToCell,
    pageRows,
  };
}
