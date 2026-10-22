import {
  CanonicalCol,
  columnLabel,
  ColIndex,
  invariant,
  type SpreadsheetStore,
  type ViewController,
} from '@sheet/core';
import type { OptionList } from './options';

/** Host-supplied column name, by stable canonical column. */
export type ColumnLabelResolver = (canonicalColumn: CanonicalCol) => string | undefined;

/** Canonical identity of a visible column; without a view every index space coincides. */
export function canonicalColumn(store: SpreadsheetStore, col: ColIndex): CanonicalCol {
  return store.view?.columns.canonicalAt(col) ?? CanonicalCol.unsafe(col);
}

/** A label set on a view-owned column wins over the host's label. */
export function columnName(
  view: ViewController | undefined,
  canonical: CanonicalCol,
  getColumnLabel: ColumnLabelResolver | undefined,
): string | undefined {
  return view?.getSnapshot().columns.owned[canonical]?.label ?? getColumnLabel?.(canonical);
}

/** A1 letter of a canonical column in the view's logical order. */
export function viewColumnLetter(view: ViewController, canonical: CanonicalCol): string {
  const logical = view.columns.logicalIndex(canonical);
  invariant(logical !== undefined, 'column missing from view order');
  return columnLabel(logical);
}

/** Every visible column as `D · Name`, valued by canonical column. */
export function columnOptions(
  view: ViewController,
  getColumnLabel: ColumnLabelResolver | undefined,
): OptionList<CanonicalCol> {
  return Array.from({ length: view.columns.count }, (_, index) => {
    const canonical = view.columns.canonicalAt(ColIndex.unsafe(index));
    const name = columnName(view, canonical, getColumnLabel);
    return {
      value: canonical,
      label: `${viewColumnLetter(view, canonical)}${name ? ` · ${name}` : ''}`,
    };
  });
}
