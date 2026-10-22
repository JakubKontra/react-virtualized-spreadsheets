import { useId } from 'react';
import { CanonicalCol, CellRange, type Address } from '@sheet/core';
import { stepFill } from './internal/fill';
import { useCell, useSpreadsheetState } from './hooks/use-cell';
import { useEditSession } from './hooks/use-edit-session';
import { useEditorProps } from './hooks/use-editor-props';
import { useFormulaEditor } from './hooks/use-formula-editor';
import { useGridLayout } from './hooks/use-grid-layout';
import { useGridProps } from './hooks/use-grid-props';
import { useRangeDrag } from './hooks/use-range-drag';
import { useSelectionSummary } from './hooks/use-selection-summary';
import { useSheetGestures } from './hooks/use-sheet-gestures';
import type {
  CellProps,
  FillHandleProps,
  SpreadsheetController,
  UseSpreadsheetOptions,
} from './types';

const DEFAULT_COLUMN_WIDTH = 120;
const defaultWidth = (_col: CanonicalCol) => DEFAULT_COLUMN_WIDTH;
const REFERENCE_OUTLINE = 'inset 0 0 0 1px #087f5b';

/** Headless spreadsheet: virtualization, keyboard, editing, gestures and ARIA prop getters. */
export function useSpreadsheet({
  store,
  scrollRef,
  rowHeight = 32,
  columnWidth = defaultWidth,
  rowHeaderWidth = 52,
  columnHeaderHeight = 34,
}: UseSpreadsheetOptions): SpreadsheetController {
  const state = useSpreadsheetState(store);
  const prefix = useId().replaceAll(':', '');
  const layout = useGridLayout({
    store,
    state,
    scrollRef,
    rowHeight,
    columnWidth,
    rowHeaderWidth,
    columnHeaderHeight,
  });
  const selection = CellRange.normalize(state.selection);
  const cellId = (address: Address) => `${prefix}-cell-${address.row}-${address.col}`;
  const { edit, navigation, focus, report } = useEditSession({
    store,
    state,
    scrollRef,
    scrollToCell: layout.scrollToCell,
  });
  const rangeDrag = useRangeDrag({ store, scrollRef, point: layout.pointToCell });
  const formula = useFormulaEditor(store, edit.draft, state.editing);
  const summary = useSelectionSummary(store, {
    range: state.selection,
    revision: state.revision,
    enabled: !state.querying,
  });
  const gestures = useSheetGestures({
    store,
    scrollRef,
    rowHeaderWidth,
    columnHeaderHeight,
    commit: () => edit.commit(),
    item: layout.item,
    itemAt: layout.itemAt,
    offset: layout.offset,
    display: layout.display,
  });
  const activeRendered =
    layout.virtualRows.some((row) => row.index === state.active.row) &&
    layout.virtualColumns.some((col) => col.index === state.active.col);
  const grid = useGridProps({
    store,
    state,
    scrollRef,
    edit,
    navigation,
    gestures,
    rowHeaderWidth,
    columnHeaderHeight,
    selection,
    pageRows: layout.pageRows,
    activeDescendant: activeRendered ? cellId(state.active) : undefined,
    report,
  });
  const activeCell = useCell(store, state.active);
  const { editor, formulaBar } = useEditorProps({
    store,
    state,
    prefix,
    edit,
    formula,
    activeCell,
    focus,
  });
  function cell(address: Address): CellProps {
    const referenceColor = formula.referenceColor(address);
    const preview = rangeDrag.preview;
    return {
      id: cellId(address),
      role: 'gridcell',
      'aria-rowindex': address.row + 1,
      'aria-colindex': address.col + 1,
      'aria-selected': CellRange.contains(selection, address),
      'aria-readonly': !store.source.isEditable(address),
      'data-address': store.labelAddress(address),
      style: referenceColor
        ? { boxShadow: `inset 0 0 0 2px ${referenceColor}` }
        : preview && CellRange.contains(preview, address)
          ? { boxShadow: REFERENCE_OUTLINE }
          : undefined,
      onPointerDown(event) {
        if (event.button !== 0) return;
        event.preventDefault();
        if (state.querying) return;
        const pick = formula.pick();
        if (pick) {
          const range = CellRange.of(address);
          pick.update(range);
          rangeDrag.start(event, {
            kind: 'reference',
            source: range,
            update: pick.update,
            cancel: pick.cancel,
          });
          return;
        }
        if (store.getSnapshot().editing) {
          const extend = event.shiftKey;
          void edit.commit().then(() => {
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
        edit.start({ address });
      },
    };
  }
  const fillHandle: FillHandleProps = {
    'aria-label': 'Autofill selection',
    onPointerDown(event) {
      if (!state.editing && !state.pending && !state.querying)
        rangeDrag.start(event, { kind: 'fill', source: selection });
    },
    onKeyDown(event) {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      report(store.fill(stepFill(selection, event.key === 'ArrowDown' ? 'down' : 'right', store)));
    },
  };
  return {
    state,
    selection,
    layout,
    edit,
    navigation,
    props: { grid, cell, editor, formulaBar, fillHandle },
    formula,
    summary,
    gestures,
    fillPreview: rangeDrag.preview,
  };
}
