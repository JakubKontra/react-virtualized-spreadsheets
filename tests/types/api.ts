// Compile-time tests, checked by `pnpm typecheck`. Each `@ts-expect-error` documents a mistake the
// public types must reject; the file is never executed.
import {
  Address,
  CanonicalCol,
  ColIndex,
  createSpreadsheet,
  Revision,
  RowIndex,
  type CellRange,
  type ColumnFilter,
  type ColumnOptions,
  type DataSource,
  type Formula,
  type Mutation,
  type SheetViewState,
  type SpreadsheetStore,
  type ViewChange,
} from '@sheet/core';
import type { CalculationProtocol, Handlers } from '@sheet/transport';
import type { SelectionSummaryState, SpreadsheetController } from '@sheet/react';

declare const store: SpreadsheetStore;
declare const source: DataSource;
declare const view: SheetViewState;
declare const range: CellRange;
const row = RowIndex.of(1);
const col = ColIndex.of(2);

// Indices of one axis cannot be used for the other.
// @ts-expect-error a column is not a row
export const swapped: Address = { row: col, col: row };
// @ts-expect-error raw numbers are not addresses
store.select({ row: 1, col: 2 });
store.select(Address.of(1, 2));

// Persisted (canonical) indices are not grid positions, and vice versa.
// @ts-expect-error canonical column used as a visible column
store.columnOptions(CanonicalCol.of(1));
// @ts-expect-error visible column used in a persisted filter
export const filter: ColumnFilter = { col, operator: 'empty' };

// Selecting a whole axis pairs the axis with its own index type.
store.selectAxis('rows', row);
// @ts-expect-error a column index for the rows axis
store.selectAxis('rows', col);

// View changes are distributed over the axis.
export const move: ViewChange = {
  type: 'move',
  axis: 'columns',
  start: col,
  count: 1,
  before: col,
};
export const badMove: ViewChange = {
  type: 'move',
  axis: 'columns',
  // @ts-expect-error row index on a column change
  start: row,
  count: 1,
  before: col,
};

// A mutation writes cells or columns, never both.
// @ts-expect-error mixed mutation
export const mixed: Mutation = { kind: 'cells', cells: [], columns: [] };

// Formulas start with `=`.
export const formula: Formula = '=SUM(A1:A3)';
// @ts-expect-error not a formula
export const notFormula: Formula = 'SUM(A1:A3)';

// Revisions are not plain numbers.
// @ts-expect-error a number is not a revision
export const revision: Revision = 0;

// Column options carry only the settings of their kind.
export const currency: ColumnOptions = { kind: 'currency', currency: 'EUR', decimals: 2 };
// @ts-expect-error select options on a number column
export const wrongOptions: ColumnOptions = { kind: 'number', options: ['a'] };

// A view needs whole-dataset calculations from its source.
// @ts-expect-error source without the `views` capability
createSpreadsheet({ source, view: { state: view } });

// Worker handler tables must implement every method of their protocol.
// @ts-expect-error `mutate` is missing
export const handlers: Handlers<CalculationProtocol> = {
  block: () => {
    throw new Error('unused');
  },
  viewBlocks: () => {
    throw new Error('unused');
  },
  viewQuery: () => {
    throw new Error('unused');
  },
  viewSummary: () => {
    throw new Error('unused');
  },
};

// The summary is only readable once ready.
export function summaryValue(summary: SelectionSummaryState) {
  // @ts-expect-error `value` exists only on the ready state
  summary.value;
  return summary.status === 'ready' ? summary.value.sum : null;
}

// Header props take the index type of their axis.
export function headers(sheet: SpreadsheetController) {
  sheet.gestures.headerProps('rows', row);
  // @ts-expect-error column index for a row header
  sheet.gestures.headerProps('rows', col);
  return sheet.layout.virtualRows.map((item) => sheet.layout.displayRow(item.index, item.start));
}

export { range };
