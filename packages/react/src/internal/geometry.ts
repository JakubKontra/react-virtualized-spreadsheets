/** How many leading items fit into `available` pixels. */
export function fitting(count: number, size: (index: number) => number, available: number): number {
  let total = 0;
  let index = 0;
  for (; index < count; index++) {
    total += size(index);
    if (total > available) break;
  }
  return index;
}

/** Total size of the first `count` items. */
export function leadingSize(count: number, size: (index: number) => number): number {
  let total = 0;
  for (let index = 0; index < count; index++) total += size(index);
  return total;
}

/** Always render frozen items, then the virtualizer's own range. */
export function withFrozen(frozen: number, indices: readonly number[]): number[] {
  return [...new Set([...Array.from({ length: frozen }, (_, i) => i), ...indices])].sort(
    (a, b) => a - b,
  );
}

/** Pixel rectangle of a cell, relative to the scroll container content. */
export interface CellRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}
/** Position of an item along one axis. */
export interface AxisItem<I extends number = number> {
  readonly index: I;
  readonly start: number;
  readonly size: number;
  readonly end: number;
}
