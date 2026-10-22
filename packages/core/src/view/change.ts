import { ViewRevision } from '../brand';
import { Index, type Axis, type AxisIndex, type AxisNameOf } from '../coords';
import { SheetError } from '../errors';
import { hasQuery } from '../features';
import { LIMITS } from '../limits';
import {
  compactSpans,
  sliceSpans,
  subtractSpans,
  ViewAxis,
  type OwnedItem,
  type ViewAxisState,
} from './axis';
import { validateViewState } from './parse';
import { newItemId, type SheetViewState } from './state';

/** Structural edits of one axis. Positions are visible indices of that axis. */
export type AxisChange<X extends Axis> =
  | {
      readonly type: 'move';
      readonly axis: X;
      readonly start: AxisIndex<X>;
      readonly count: number;
      /** Visible position to insert before; `count` of the axis appends. */
      readonly before: AxisIndex<X>;
    }
  | {
      readonly type: 'hide';
      readonly axis: X;
      readonly start: AxisIndex<X>;
      readonly count: number;
    }
  | {
      readonly type: 'remove';
      readonly axis: X;
      readonly start: AxisIndex<X>;
      readonly count: number;
    }
  | { readonly type: 'showAll'; readonly axis: X }
  | {
      readonly type: 'resize';
      readonly axis: X;
      readonly start: AxisIndex<X>;
      readonly count: number;
      readonly size: number;
    }
  | {
      readonly type: 'insert';
      readonly axis: X;
      readonly before: AxisIndex<X>;
      readonly label?: string | undefined;
    };
/** Distributes over the axis so an index of one axis cannot address the other. */
export type ViewChange = AxisChange<'rows'> | AxisChange<'columns'>;

const MIN_SIZE: Readonly<Record<Axis, number>> = { rows: 24, columns: 48 };
const MAX_SIZE = 2000;

function changeAxis<X extends Axis>(
  original: ViewAxisState<AxisNameOf<X>>,
  change: AxisChange<X>,
): ViewAxisState<AxisNameOf<X>> | null {
  type A = AxisNameOf<X>;
  const axis = new ViewAxis(original);
  const at = (value: number) => Index.unsafe<A, 'canonical'>(value);
  switch (change.type) {
    case 'showAll':
      return { ...original, hidden: [] };
    case 'insert': {
      if (!Number.isInteger(change.before) || change.before < 0 || change.before > axis.count)
        throw new SheetError('OUT_OF_BOUNDS', 'Invalid insertion position');
      const logical =
        change.before === axis.count
          ? axis.logicalCount
          : (axis.logicalIndex(axis.canonicalAt(change.before)) ?? axis.logicalCount);
      const item: OwnedItem = {
        id: newItemId(),
        ...(change.label === undefined ? {} : { label: change.label }),
      };
      return {
        ...original,
        order: compactSpans([
          ...sliceSpans(original.order, 0, logical),
          { start: at(original.nextIndex), count: 1 },
          ...sliceSpans(original.order, logical, axis.logicalCount - logical),
        ]),
        owned: { ...original.owned, [original.nextIndex]: item },
        nextIndex: original.nextIndex + 1,
      };
    }
  }
  if (
    !Number.isInteger(change.start) ||
    !Number.isInteger(change.count) ||
    change.start < 0 ||
    change.count < 1 ||
    change.start + change.count > axis.count
  )
    throw new SheetError('OUT_OF_BOUNDS', 'Invalid axis selection');
  const selected = axis.slice(change.start, change.count);
  switch (change.type) {
    case 'resize': {
      if (!Number.isFinite(change.size)) throw new SheetError('INVALID_INPUT', 'Invalid axis size');
      if (change.count > LIMITS.maxResizeItems)
        throw new SheetError('LIMIT_EXCEEDED', 'Resize at most 10,000 items at once');
      const size = Math.round(Math.max(MIN_SIZE[change.axis], Math.min(MAX_SIZE, change.size)));
      const sizes = { ...original.sizes };
      for (const span of selected)
        for (let index = span.start; index < span.start + span.count; index++) sizes[index] = size;
      return { ...original, sizes };
    }
    case 'hide':
      return { ...original, hidden: compactSpans([...original.hidden, ...selected]) };
    case 'remove': {
      if (change.count > Object.keys(original.owned).length)
        throw new SheetError('READ_ONLY', 'Source items can be hidden, not removed');
      for (const span of selected)
        for (let index = span.start; index < span.start + span.count; index++)
          if (!original.owned[index])
            throw new SheetError('READ_ONLY', 'Source items can be hidden, not removed');
      return { ...original, order: subtractSpans(original.order, selected) };
    }
    case 'move': {
      if (!Number.isInteger(change.before) || change.before < 0 || change.before > axis.count)
        throw new SheetError('OUT_OF_BOUNDS', 'Invalid drop position');
      if (change.before >= change.start && change.before <= change.start + change.count)
        return null;
      const target = change.before === axis.count ? null : axis.canonicalAt(change.before);
      const remaining = subtractSpans(original.order, selected);
      const remainingAxis = new ViewAxis({ ...original, order: remaining });
      const position =
        target === null
          ? remainingAxis.logicalCount
          : (remainingAxis.logicalIndex(target) ?? remainingAxis.logicalCount);
      return {
        ...original,
        order: compactSpans([
          ...sliceSpans(remaining, 0, position),
          ...selected,
          ...sliceSpans(remaining, position, remainingAxis.logicalCount - position),
        ]),
      };
    }
  }
}

/** Applies a structural change and returns the next (validated) view, or the same view if no-op. */
export function changeView(state: SheetViewState, change: ViewChange): SheetViewState {
  if (change.axis === 'rows' && hasQuery(state.query))
    throw new SheetError('UNSUPPORTED', 'Clear sorting and filters before changing row structure');
  let next: SheetViewState | null;
  if (change.axis === 'rows') {
    const rows = changeAxis(state.rows, change);
    next = rows && { ...state, rows };
  } else {
    const columns = changeAxis(state.columns, change);
    next = columns && { ...state, columns };
  }
  if (!next) return state;
  const result = { ...next, revision: ViewRevision.next(state.revision) };
  validateViewState(result);
  return result;
}
