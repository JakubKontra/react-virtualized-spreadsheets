import type { Brand } from './brand';
import { SheetError } from './errors';

/**
 * Indices live in three coordinate spaces:
 * - `visible`: what the grid renders and the store addresses (after hiding and filtering).
 * - `logical`: view order including hidden items; A1 labels and formulas use it.
 * - `canonical`: stable identity of a row or column, independent of order. Persisted view data
 *   (cell overrides, column formulas, options, filters, sorts, sizes) is keyed by it.
 * Without a view, all three coincide with the data source's own indices.
 */
export type IndexSpace = 'visible' | 'logical' | 'canonical';
export type AxisName = 'row' | 'col';
export type Index<A extends AxisName, S extends IndexSpace = 'visible'> = Brand<
  number,
  `${A}:${S}`
>;

export type RowIndex = Index<'row'>;
export type ColIndex = Index<'col'>;
export type LogicalRow = Index<'row', 'logical'>;
export type LogicalCol = Index<'col', 'logical'>;
export type CanonicalRow = Index<'row', 'canonical'>;
export type CanonicalCol = Index<'col', 'canonical'>;

/** View axes are named in the plural. */
export type Axis = 'rows' | 'columns';
export type AxisNameOf<X extends Axis> = X extends 'rows' ? 'row' : 'col';
export type AxisIndex<X extends Axis, S extends IndexSpace = 'visible'> = Index<AxisNameOf<X>, S>;

export interface IndexOps<I extends number> {
  /** Validates a non-negative safe integer. */
  of(value: number): I;
  /** Brands without checks. Use for loop counters and data that was validated elsewhere. */
  unsafe(value: number): I;
  isValid(value: unknown): value is I;
  offset(index: I, delta: number): I;
  /** Clamps into `[0, count - 1]`. */
  clamp(value: number, count: number): I;
  min(a: I, b: I): I;
  max(a: I, b: I): I;
  /** The last index of an axis with `count` items. */
  last(count: number): I;
}

function indexOps<I extends number>(name: string): IndexOps<I> {
  // The only place a number becomes a branded index; brands carry no runtime data.
  const unsafe = (value: number) => value as I;
  const isValid = (value: unknown): value is I =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
  return {
    of(value) {
      if (!isValid(value)) throw new SheetError('OUT_OF_BOUNDS', `Invalid ${name} index`);
      return value;
    },
    unsafe,
    isValid,
    offset: (index, delta) => unsafe(index + delta),
    clamp: (value, count) => unsafe(Math.max(0, Math.min(count - 1, Math.trunc(value)))),
    min: (a, b) => (a < b ? a : b),
    max: (a, b) => (a > b ? a : b),
    last: (count) => unsafe(count - 1),
  };
}

export const RowIndex = indexOps<RowIndex>('row');
export const ColIndex = indexOps<ColIndex>('column');
export const LogicalRow = indexOps<LogicalRow>('row');
export const LogicalCol = indexOps<LogicalCol>('column');
export const CanonicalRow = indexOps<CanonicalRow>('row');
export const CanonicalCol = indexOps<CanonicalCol>('column');

/** Generic helpers for code that is polymorphic over axis or space. */
export const Index = {
  unsafe: <A extends AxisName, S extends IndexSpace = 'visible'>(value: number) =>
    value as Index<A, S>,
} as const;

export const axisName = <X extends Axis>(axis: X): AxisNameOf<X> =>
  // Conditional types cannot be narrowed by a runtime check; the mapping is total.
  (axis === 'rows' ? 'row' : 'col') as AxisNameOf<X>;

export interface Address<S extends IndexSpace = 'visible'> {
  readonly row: Index<'row', S>;
  readonly col: Index<'col', S>;
}
export type LogicalAddress = Address<'logical'>;
export type CanonicalAddress = Address<'canonical'>;

export interface CellRange<S extends IndexSpace = 'visible'> {
  readonly start: Address<S>;
  readonly end: Address<S>;
}

export const Address = {
  /** Validates both indices. */
  /** Validates both indices; pass a space for logical or canonical addresses. */
  of: <S extends IndexSpace = 'visible'>(row: number, col: number): Address<S> => {
    if (!RowIndex.isValid(row) || !ColIndex.isValid(col))
      throw new SheetError('OUT_OF_BOUNDS', 'Invalid address');
    return { row: Index.unsafe<'row', S>(row), col: Index.unsafe<'col', S>(col) };
  },
  /** Brands without checks, in any space. */
  unsafe: <S extends IndexSpace = 'visible'>(row: number, col: number): Address<S> => ({
    row: Index.unsafe<'row', S>(row),
    col: Index.unsafe<'col', S>(col),
  }),
  isValid: (value: unknown): value is Address =>
    typeof value === 'object' &&
    value !== null &&
    'row' in value &&
    'col' in value &&
    RowIndex.isValid(value.row) &&
    ColIndex.isValid(value.col),
  equals: <S extends IndexSpace>(a: Address<S>, b: Address<S>) =>
    a.row === b.row && a.col === b.col,
  offset: <S extends IndexSpace>(a: Address<S>, rows: number, cols: number): Address<S> => ({
    row: Index.unsafe<'row', S>(a.row + rows),
    col: Index.unsafe<'col', S>(a.col + cols),
  }),
  /** Clamps into a sheet of the given size. */
  clamp: (row: number, col: number, size: { rows: number; columns: number }): Address => ({
    row: RowIndex.clamp(row, size.rows),
    col: ColIndex.clamp(col, size.columns),
  }),
} as const;

export const CellRange = {
  of: <S extends IndexSpace>(start: Address<S>, end: Address<S> = start): CellRange<S> => ({
    start,
    end,
  }),
  unsafe: <S extends IndexSpace = 'visible'>(
    startRow: number,
    startCol: number,
    endRow: number,
    endCol: number,
  ): CellRange<S> => ({
    start: Address.unsafe<S>(startRow, startCol),
    end: Address.unsafe<S>(endRow, endCol),
  }),
  normalize: <S extends IndexSpace>(range: CellRange<S>): CellRange<S> => ({
    start: {
      row: range.start.row < range.end.row ? range.start.row : range.end.row,
      col: range.start.col < range.end.col ? range.start.col : range.end.col,
    },
    end: {
      row: range.start.row > range.end.row ? range.start.row : range.end.row,
      col: range.start.col > range.end.col ? range.start.col : range.end.col,
    },
  }),
  contains: <S extends IndexSpace>(range: CellRange<S>, address: Address<S>) =>
    address.row >= range.start.row &&
    address.row <= range.end.row &&
    address.col >= range.start.col &&
    address.col <= range.end.col,
  equals: <S extends IndexSpace>(a: CellRange<S>, b: CellRange<S>) =>
    Address.equals(a.start, b.start) && Address.equals(a.end, b.end),
  rows: (range: CellRange<IndexSpace>) => range.end.row - range.start.row + 1,
  columns: (range: CellRange<IndexSpace>) => range.end.col - range.start.col + 1,
  /** Number of cells in a normalized range. */
  size: (range: CellRange<IndexSpace>) =>
    (range.end.row - range.start.row + 1) * (range.end.col - range.start.col + 1),
} as const;

/** `row:col` key of an address. The space is documented by the map that uses it. */
export type CellKey = `${number}:${number}`;
export const cellKey = (address: Address<IndexSpace>): CellKey => `${address.row}:${address.col}`;
export function parseCellKey<S extends IndexSpace = 'visible'>(key: string): Address<S> | null {
  const match = /^(\d+):(\d+)$/.exec(key);
  if (!match) return null;
  const row = Number(match[1]);
  const col = Number(match[2]);
  return Number.isSafeInteger(row) && Number.isSafeInteger(col)
    ? Address.unsafe<S>(row, col)
    : null;
}

export function columnLabel(col: number): string {
  let label = '';
  for (let n = col + 1; n > 0; n = Math.floor((n - 1) / 26))
    label = String.fromCharCode(65 + ((n - 1) % 26)) + label;
  return label;
}

/** A1 label of an address. Pass a logical address when a view is configured. */
export const addressLabel = (address: Address<IndexSpace>) =>
  `${columnLabel(address.col)}${address.row + 1}`;

/** Parses `B12`, `$B$12` and similar. The result is in the space the label was written in. */
export function parseA1<S extends IndexSpace = 'visible'>(label: string): Address<S> | null {
  const match = /^\$?([A-Z]+)\$?([1-9]\d*)$/i.exec(label);
  const letters = match?.[1];
  const digits = match?.[2];
  if (letters === undefined || digits === undefined) return null;
  let col = 0;
  for (const ch of letters.toUpperCase()) col = col * 26 + ch.charCodeAt(0) - 64;
  const row = Number(digits) - 1;
  return Number.isSafeInteger(col) && Number.isSafeInteger(row)
    ? Address.unsafe<S>(row, col - 1)
    : null;
}

/** Identity mapping for code paths without a view, where every space coincides. */
export const sameSpace = <S extends IndexSpace, T extends IndexSpace>(
  address: Address<S>,
): Address<T> => Address.unsafe<T>(address.row, address.col);

/**
 * The one sanctioned bridge between a view and its base source: a canonical index below the
 * source's dimensions is the source's own index.
 */
export const sourceRow = (row: CanonicalRow): RowIndex => RowIndex.unsafe(row);
export const sourceCol = (col: CanonicalCol): ColIndex => ColIndex.unsafe(col);
export const sourceAddress = (address: CanonicalAddress): Address => sameSpace(address);
