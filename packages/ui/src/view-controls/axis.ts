import {
  ColIndex,
  RowIndex,
  type Axis,
  type AxisChange,
  type AxisIndex,
  type AxisName,
  type Index,
  type ViewAxis,
  type ViewChange,
  type ViewController,
} from '@sheet/core';
import type { AxisSelection } from '@sheet/react';

/** What the header menu needs to know about one axis of the view, independent of its brand. */
export interface AxisInfo {
  readonly count: number;
  readonly hasHidden: boolean;
  /** Only view-owned items can be removed; source items can only be hidden. */
  canRemove(selection: AxisSelection): boolean;
}

function describe<A extends AxisName>(
  axis: ViewAxis<A>,
  at: (index: number) => Index<A>,
): AxisInfo {
  const owned = Object.keys(axis.state.owned).length;
  return {
    count: axis.count,
    hasHidden: axis.state.hidden.length > 0,
    canRemove: ({ start, count }) =>
      count <= owned &&
      Array.from({ length: count }, (_, i) => start + i).every((index) => axis.isOwned(at(index))),
  };
}

export function axisInfo(view: ViewController, axis: Axis): AxisInfo {
  switch (axis) {
    case 'rows':
      return describe(view.rows, RowIndex.unsafe);
    case 'columns':
      return describe(view.columns, ColIndex.unsafe);
  }
}

/** Builds a change for an axis known only at runtime, with indices branded for that axis. */
export type AxisChangeBuilder = <X extends Axis>(
  axis: X,
  at: (index: number) => AxisIndex<X>,
) => AxisChange<X>;

export function changeOnAxis(axis: Axis, build: AxisChangeBuilder): ViewChange {
  switch (axis) {
    case 'rows':
      return build('rows', RowIndex.unsafe);
    case 'columns':
      return build('columns', ColIndex.unsafe);
  }
}

export const AXIS_NOUNS = {
  rows: { one: 'row', many: 'rows' },
  columns: { one: 'column', many: 'columns' },
} as const satisfies Record<Axis, { one: string; many: string }>;

/** `row` / `column` for one item, the axis name for several. */
export const axisNoun = (axis: Axis, count: number): string =>
  count === 1 ? AXIS_NOUNS[axis].one : AXIS_NOUNS[axis].many;

/** Minimum size of a row or column, in pixels. */
export const MIN_SIZE = { rows: 24, columns: 48 } as const satisfies Record<Axis, number>;
export const MAX_SIZE = 2000;
