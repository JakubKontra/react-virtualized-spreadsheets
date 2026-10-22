import { CellRange } from '@sheet/core';

/** Inclusive `[first, last]` runs of consecutive indices. */
export type Run = readonly [first: number, last: number];

export function runs(indices: readonly number[]): Run[] {
  const result: [number, number][] = [];
  for (const index of indices) {
    const last = result.at(-1);
    if (last && last[1] + 1 === index) last[1] = index;
    else result.push([index, index]);
  }
  return result;
}

export const runsEqual = (a: readonly Run[], b: readonly Run[]): boolean =>
  a.length === b.length && a.every((run, i) => run[0] === b[i]?.[0] && run[1] === b[i]?.[1]);

/** One viewport range per pair of row and column runs (frozen panes split the grid). */
export const viewportsFromRuns = (rows: readonly Run[], columns: readonly Run[]): CellRange[] =>
  rows.flatMap(([r0, r1]) => columns.map(([c0, c1]) => CellRange.unsafe(r0, c0, r1, c1)));
