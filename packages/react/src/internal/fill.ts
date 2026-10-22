import { Address, CellRange } from '@sheet/core';

/**
 * Extends `source` toward `point` along the dominant direction only, as a fill handle drag does.
 */
export function fillTarget(source: CellRange, point: Address): CellRange {
  const dr = Math.max(source.start.row - point.row, point.row - source.end.row, 0);
  const dc = Math.max(source.start.col - point.col, point.col - source.end.col, 0);
  return dr >= dc
    ? CellRange.unsafe(
        Math.min(source.start.row, point.row),
        source.start.col,
        Math.max(source.end.row, point.row),
        source.end.col,
      )
    : CellRange.unsafe(
        source.start.row,
        Math.min(source.start.col, point.col),
        source.end.row,
        Math.max(source.end.col, point.col),
      );
}

/** Grows a fill one step down or right, clamped to the sheet. */
export function stepFill(
  selection: CellRange,
  direction: 'down' | 'right',
  size: { readonly rows: number; readonly columns: number },
): CellRange {
  const { end } = selection;
  return CellRange.of(
    selection.start,
    direction === 'down'
      ? Address.unsafe(Math.min(size.rows - 1, end.row + 1), end.col)
      : Address.unsafe(end.row, Math.min(size.columns - 1, end.col + 1)),
  );
}
