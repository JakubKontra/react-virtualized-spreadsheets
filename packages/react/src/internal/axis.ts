import {
  ColIndex,
  Index,
  RowIndex,
  type Axis,
  type AxisIndex,
  type AxisNameOf,
  type ViewChange,
} from '@sheet/core';

/** Brands a computed position for the given axis. */
export const axisIndex = <X extends Axis>(_axis: X, value: number): AxisIndex<X> =>
  Index.unsafe<AxisNameOf<X>>(value);

export const coordinate = (axis: Axis) => (axis === 'rows' ? 'row' : 'col');

/** Builds a move or resize change for a runtime axis without losing the axis/index pairing. */
export function spanChange(
  axis: Axis,
  span: { readonly start: number; readonly count: number },
  change:
    | { readonly type: 'move'; readonly before: number }
    | { readonly type: 'resize'; readonly size: number },
): ViewChange {
  if (axis === 'rows') {
    const start = RowIndex.unsafe(span.start);
    return change.type === 'move'
      ? { type: 'move', axis, start, count: span.count, before: RowIndex.unsafe(change.before) }
      : { type: 'resize', axis, start, count: span.count, size: change.size };
  }
  const start = ColIndex.unsafe(span.start);
  return change.type === 'move'
    ? { type: 'move', axis, start, count: span.count, before: ColIndex.unsafe(change.before) }
    : { type: 'resize', axis, start, count: span.count, size: change.size };
}
