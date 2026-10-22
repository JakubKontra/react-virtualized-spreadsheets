import { Index, type AxisName, type IndexSpace } from '../coords';
import { SheetError } from '../errors';

/** A run of consecutive indices. Persisted spans are canonical. */
export interface AxisSpan<A extends AxisName, S extends IndexSpace = 'canonical'> {
  readonly start: Index<A, S>;
  readonly count: number;
}
/** A row or column created in the view rather than supplied by the source. */
export interface OwnedItem {
  readonly id: string;
  readonly label?: string;
}
export interface ViewAxisState<A extends AxisName> {
  /** Canonical indices never change. A span represents a run of stable source identities. */
  readonly order: readonly AxisSpan<A>[];
  readonly hidden: readonly AxisSpan<A>[];
  /** Pixel sizes keyed by canonical index. */
  readonly sizes: Readonly<Partial<Record<number, number>>>;
  /** View-owned items keyed by canonical index. */
  readonly owned: Readonly<Partial<Record<number, OwnedItem>>>;
  readonly nextIndex: number;
}

type MutableSpan<A extends AxisName, S extends IndexSpace> = { start: Index<A, S>; count: number };

export function compactSpans<A extends AxisName, S extends IndexSpace>(
  spans: readonly AxisSpan<A, S>[],
): AxisSpan<A, S>[] {
  const result: MutableSpan<A, S>[] = [];
  for (const span of spans) {
    if (span.count <= 0) continue;
    const last = result.at(-1);
    if (last && last.start + last.count === span.start) last.count += span.count;
    else result.push({ ...span });
  }
  return result;
}

/** Spans covering positions `[start, start + count)` of the concatenated input spans. */
export function sliceSpans<A extends AxisName, S extends IndexSpace>(
  spans: readonly AxisSpan<A, S>[],
  start: number,
  count: number,
): AxisSpan<A, S>[] {
  const result: AxisSpan<A, S>[] = [];
  let offset = 0;
  for (const span of spans) {
    const from = Math.max(0, start - offset);
    const to = Math.min(span.count, start + count - offset);
    if (from < to) result.push({ start: Index.unsafe<A, S>(span.start + from), count: to - from });
    offset += span.count;
    if (offset >= start + count) break;
  }
  return result;
}

export function subtractSpans<A extends AxisName, S extends IndexSpace>(
  spans: readonly AxisSpan<A, S>[],
  removed: readonly AxisSpan<A, S>[],
): AxisSpan<A, S>[] {
  let result: readonly AxisSpan<A, S>[] = spans;
  for (const cut of removed)
    result = result.flatMap((span) => {
      const left = Math.max(span.start, cut.start);
      const right = Math.min(span.start + span.count, cut.start + cut.count);
      if (left >= right) return [span];
      return [
        { start: span.start, count: left - span.start },
        { start: Index.unsafe<A, S>(right), count: span.start + span.count - right },
      ].filter((part) => part.count > 0);
    });
  return compactSpans(result);
}

/** Maps between visible, logical and canonical indices of one axis. */
export class ViewAxis<A extends AxisName> {
  readonly visible: readonly AxisSpan<A>[];
  readonly count: number;
  readonly logicalCount: number;
  private inverse: Int32Array | undefined;
  constructor(
    readonly state: ViewAxisState<A>,
    /** Canonical indices in display order, when a query filters or sorts the axis. */
    readonly projection?: Uint32Array,
  ) {
    this.visible = subtractSpans(state.order, state.hidden);
    this.count = projection?.length ?? this.visible.reduce((sum, span) => sum + span.count, 0);
    if (projection) {
      const inverse = new Int32Array(state.nextIndex).fill(-1);
      projection.forEach((canonical, index) => {
        inverse[canonical] = index;
      });
      this.inverse = inverse;
    }
    this.logicalCount = state.order.reduce((sum, span) => sum + span.count, 0);
  }
  private at(spans: readonly AxisSpan<A>[], index: number): Index<A, 'canonical'> {
    if (!Number.isInteger(index) || index < 0)
      throw new SheetError('OUT_OF_BOUNDS', 'Invalid axis position');
    for (const span of spans) {
      if (index < span.count) return Index.unsafe<A, 'canonical'>(span.start + index);
      index -= span.count;
    }
    throw new SheetError('OUT_OF_BOUNDS', 'Axis position is outside the view');
  }
  private position(spans: readonly AxisSpan<A>[], canonical: number): number | undefined {
    let offset = 0;
    for (const span of spans) {
      if (canonical >= span.start && canonical < span.start + span.count)
        return offset + canonical - span.start;
      offset += span.count;
    }
    return undefined;
  }
  canonicalAt(index: Index<A>): Index<A, 'canonical'> {
    if (this.projection) {
      const canonical = Number.isInteger(index) && index >= 0 ? this.projection[index] : undefined;
      if (canonical === undefined)
        throw new SheetError('OUT_OF_BOUNDS', 'Axis position is outside the view');
      return Index.unsafe<A, 'canonical'>(canonical);
    }
    return this.at(this.visible, index);
  }
  canonicalAtLogical(index: Index<A, 'logical'>): Index<A, 'canonical'> {
    return this.at(this.state.order, index);
  }
  visibleIndex(canonical: Index<A, 'canonical'>): Index<A> | undefined {
    const index = this.inverse ? this.inverse[canonical] : this.position(this.visible, canonical);
    return index === undefined || index < 0 ? undefined : Index.unsafe<A>(index);
  }
  logicalIndex(canonical: Index<A, 'canonical'>): Index<A, 'logical'> | undefined {
    const index = this.position(this.state.order, canonical);
    return index === undefined ? undefined : Index.unsafe<A, 'logical'>(index);
  }
  has(canonical: Index<A, 'canonical'>): boolean {
    return this.position(this.state.order, canonical) !== undefined;
  }
  isOwned(index: Index<A>): boolean {
    return !!this.state.owned[this.canonicalAt(index)];
  }
  size(index: Index<A>, fallback: number): number {
    return this.state.sizes[this.canonicalAt(index)] ?? fallback;
  }
  /** Canonical spans of `count` visible positions starting at `start`. */
  slice(start: Index<A>, count: number): AxisSpan<A>[] {
    if (this.projection)
      return compactSpans(
        Array.from(this.projection.subarray(start, start + count), (value) => ({
          start: Index.unsafe<A, 'canonical'>(value),
          count: 1,
        })),
      );
    return sliceSpans(this.visible, start, count);
  }
  /** Canonical spans of `count` logical positions starting at `start`. */
  logicalSlice(start: Index<A, 'logical'>, count: number): AxisSpan<A>[] {
    return sliceSpans(this.state.order, start, count);
  }
  /** Convert canonical intervals to logical intervals without enumerating their members. */
  logicalSpans(span: AxisSpan<A>): AxisSpan<A, 'logical'>[] {
    const result: AxisSpan<A, 'logical'>[] = [];
    let offset = 0;
    for (const part of this.state.order) {
      const from = Math.max(part.start, span.start);
      const to = Math.min(part.start + part.count, span.start + span.count);
      if (from < to)
        result.push({
          start: Index.unsafe<A, 'logical'>(offset + from - part.start),
          count: to - from,
        });
      offset += part.count;
    }
    return compactSpans(result);
  }
  /** True when the axis shows every source item in source order. */
  get isIdentity(): boolean {
    const [only] = this.state.order;
    return (
      this.state.order.length === 1 && only?.start === 0 && only.count === this.state.nextIndex
    );
  }
}
