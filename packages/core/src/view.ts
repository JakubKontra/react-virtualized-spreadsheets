import type { CellInput, DataSource } from './types';

export type Axis = 'rows' | 'columns';
export interface AxisSpan {
  start: number;
  count: number;
}
export interface ViewAxisState {
  /** Canonical indices never change. A span represents a run of stable source identities. */
  order: AxisSpan[];
  hidden: AxisSpan[];
  sizes: Record<number, number>;
  owned: Record<number, { id: string; label?: string }>;
  nextIndex: number;
}
export interface SheetViewState {
  schemaVersion: 1;
  viewId: string;
  sourceId: string;
  sourceRows: number;
  sourceColumns: number;
  revision: number;
  rows: ViewAxisState;
  columns: ViewAxisState;
  /** Inputs and formulas use canonical coordinates, independent of visual order. */
  cells: Record<string, CellInput>;
  columnFormulas: Record<number, string | null>;
}
export interface PersistedView {
  state: SheetViewState;
  version: string | null;
}
export interface ViewPersistenceAdapter {
  load(viewId: string, signal: AbortSignal): Promise<PersistedView | null>;
  save(
    state: SheetViewState,
    expectedVersion: string | null,
    signal: AbortSignal,
  ): Promise<PersistedView>;
}
export type ViewChange =
  | { type: 'move'; axis: Axis; start: number; count: number; before: number }
  | { type: 'hide'; axis: Axis; start: number; count: number }
  | { type: 'remove'; axis: Axis; start: number; count: number }
  | { type: 'showAll'; axis: Axis }
  | { type: 'resize'; axis: Axis; start: number; count: number; size: number }
  | { type: 'insert'; axis: Axis; before: number; label?: string };

export function compactSpans(spans: AxisSpan[]): AxisSpan[] {
  const result: AxisSpan[] = [];
  for (const span of spans) {
    if (span.count <= 0) continue;
    const last = result.at(-1);
    if (last && last.start + last.count === span.start) last.count += span.count;
    else result.push({ ...span });
  }
  return result;
}
export function sliceSpans(spans: AxisSpan[], start: number, count: number): AxisSpan[] {
  const result: AxisSpan[] = [];
  let offset = 0;
  for (const span of spans) {
    const from = Math.max(0, start - offset);
    const to = Math.min(span.count, start + count - offset);
    if (from < to) result.push({ start: span.start + from, count: to - from });
    offset += span.count;
    if (offset >= start + count) break;
  }
  return result;
}
function subtractSpans(spans: AxisSpan[], removed: AxisSpan[]) {
  let result = spans;
  for (const cut of removed)
    result = result.flatMap((span) => {
      const left = Math.max(span.start, cut.start);
      const right = Math.min(span.start + span.count, cut.start + cut.count);
      if (left >= right) return [span];
      return [
        { start: span.start, count: left - span.start },
        { start: right, count: span.start + span.count - right },
      ].filter((part) => part.count > 0);
    });
  return compactSpans(result);
}
export class ViewAxis {
  readonly visible: AxisSpan[];
  readonly count: number;
  readonly logicalCount: number;
  constructor(readonly state: ViewAxisState) {
    this.visible = subtractSpans(state.order, state.hidden);
    this.count = this.visible.reduce((sum, span) => sum + span.count, 0);
    this.logicalCount = state.order.reduce((sum, span) => sum + span.count, 0);
  }
  private at(spans: AxisSpan[], index: number) {
    if (!Number.isInteger(index) || index < 0) throw new Error('Invalid axis position');
    for (const span of spans) {
      if (index < span.count) return span.start + index;
      index -= span.count;
    }
    throw new Error('Axis position is outside the view');
  }
  private index(spans: AxisSpan[], canonical: number) {
    let offset = 0;
    for (const span of spans) {
      if (canonical >= span.start && canonical < span.start + span.count)
        return offset + canonical - span.start;
      offset += span.count;
    }
    return -1;
  }
  canonicalAt(index: number) {
    return this.at(this.visible, index);
  }
  canonicalAtLogical(index: number) {
    return this.at(this.state.order, index);
  }
  visibleIndex(canonical: number) {
    return this.index(this.visible, canonical);
  }
  logicalIndex(canonical: number) {
    return this.index(this.state.order, canonical);
  }
  has(canonical: number) {
    return this.logicalIndex(canonical) !== -1;
  }
  isOwned(index: number) {
    return !!this.state.owned[this.canonicalAt(index)];
  }
  size(index: number, fallback: number) {
    return this.state.sizes[this.canonicalAt(index)] ?? fallback;
  }
  slice(start: number, count: number) {
    return sliceSpans(this.visible, start, count);
  }
  logicalSlice(start: number, count: number) {
    return sliceSpans(this.state.order, start, count);
  }
  /** Convert canonical intervals to logical intervals without enumerating their members. */
  logicalSpans(span: AxisSpan): AxisSpan[] {
    const result: AxisSpan[] = [];
    let offset = 0;
    for (const part of this.state.order) {
      const from = Math.max(part.start, span.start);
      const to = Math.min(part.start + part.count, span.start + span.count);
      if (from < to) result.push({ start: offset + from - part.start, count: to - from });
      offset += part.count;
    }
    return compactSpans(result);
  }
}
const newId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
export function createViewState(
  source: DataSource,
  options: {
    viewId: string;
    sourceId: string;
    ownedColumns?: number[];
    labels?: Record<number, string>;
  },
): SheetViewState {
  const axis = (count: number): ViewAxisState => ({
    order: [{ start: 0, count }],
    hidden: [],
    sizes: {},
    owned: {},
    nextIndex: count,
  });
  const columns = axis(source.metadata.columns);
  const columnFormulas: Record<number, string | null> = {};
  for (let col = 0; col < source.metadata.columns; col++) {
    const formula = source.getColumnFormula(col);
    if (formula !== null) columnFormulas[col] = formula;
  }
  for (const col of options.ownedColumns ?? [])
    columns.owned[col] = { id: `custom:${newId()}`, label: options.labels?.[col] };
  return {
    schemaVersion: 1,
    viewId: options.viewId,
    sourceId: options.sourceId,
    sourceRows: source.metadata.rows,
    sourceColumns: source.metadata.columns,
    revision: 0,
    rows: axis(source.metadata.rows),
    columns,
    cells: {},
    columnFormulas,
  };
}
export function validateViewState(value: unknown): asserts value is SheetViewState {
  const state = value as SheetViewState;
  if (
    !state ||
    state.schemaVersion !== 1 ||
    typeof state.viewId !== 'string' ||
    !state.viewId ||
    typeof state.sourceId !== 'string' ||
    !Number.isSafeInteger(state.revision) ||
    state.revision < 0
  )
    throw new Error('Invalid view document');
  for (const key of ['sourceRows', 'sourceColumns'] as const)
    if (!Number.isSafeInteger(state[key]) || state[key] < 1)
      throw new Error('Invalid source dimensions');
  for (const name of ['rows', 'columns'] as const) {
    const axis = state[name];
    if (
      !axis ||
      !Number.isSafeInteger(axis.nextIndex) ||
      axis.nextIndex < (name === 'rows' ? state.sourceRows : state.sourceColumns) ||
      !Array.isArray(axis.order) ||
      !Array.isArray(axis.hidden) ||
      !axis.sizes ||
      !axis.owned
    )
      throw new Error('Invalid view axis');
    for (const span of [...axis.order, ...axis.hidden])
      if (
        !Number.isSafeInteger(span.start) ||
        span.start < 0 ||
        !Number.isSafeInteger(span.count) ||
        span.count < 1 ||
        span.start + span.count > axis.nextIndex
      )
        throw new Error('Invalid axis span');
    const sorted = [...axis.order].sort((a, b) => a.start - b.start);
    if (sorted.some((span, i) => i > 0 && sorted[i - 1].start + sorted[i - 1].count > span.start))
      throw new Error('Duplicate axis identity');
    if (new ViewAxis(axis).count < 1) throw new Error('Keep at least one visible row and column');
    for (const [key, size] of Object.entries(axis.sizes))
      if (
        !Number.isInteger(Number(key)) ||
        Number(key) < 0 ||
        Number(key) >= axis.nextIndex ||
        !Number.isFinite(size) ||
        size < (name === 'rows' ? 24 : 48) ||
        size > 2000
      )
        throw new Error('Invalid axis size');
    for (const [key, owned] of Object.entries(axis.owned))
      if (
        !Number.isInteger(Number(key)) ||
        Number(key) < 0 ||
        Number(key) >= axis.nextIndex ||
        !owned ||
        typeof owned.id !== 'string' ||
        !owned.id ||
        (owned.label !== undefined && typeof owned.label !== 'string')
      )
        throw new Error('Invalid custom identity');
  }
  if (!state.cells || !state.columnFormulas) throw new Error('Invalid view inputs');
  for (const [key, value] of Object.entries(state.cells)) {
    const parts = key.split(':').map(Number);
    if (
      parts.length !== 2 ||
      parts.some(
        (part, i) =>
          !Number.isInteger(part) ||
          part < 0 ||
          part >= (i === 0 ? state.rows.nextIndex : state.columns.nextIndex),
      )
    )
      throw new Error('Invalid cell identity');
    if (
      (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) ||
      (typeof value === 'number' && !Number.isFinite(value))
    )
      throw new Error('Invalid view cell');
  }
  for (const [key, value] of Object.entries(state.columnFormulas))
    if (
      !Number.isInteger(Number(key)) ||
      Number(key) < 0 ||
      Number(key) >= state.columns.nextIndex ||
      (value !== null && (typeof value !== 'string' || !value.startsWith('=')))
    )
      throw new Error('Invalid column formula');
}
export function changeView(state: SheetViewState, change: ViewChange): SheetViewState {
  const original = state[change.axis];
  const axis = new ViewAxis(original);
  let next: ViewAxisState = { ...original };
  if (change.type === 'showAll') next.hidden = [];
  else if (change.type === 'insert') {
    if (!Number.isInteger(change.before) || change.before < 0 || change.before > axis.count)
      throw new Error('Invalid insertion position');
    const logical =
      change.before === axis.count
        ? axis.logicalCount
        : axis.logicalIndex(axis.canonicalAt(change.before));
    next.order = compactSpans([
      ...sliceSpans(original.order, 0, logical),
      { start: original.nextIndex, count: 1 },
      ...sliceSpans(original.order, logical, axis.logicalCount - logical),
    ]);
    next.owned = {
      ...original.owned,
      [original.nextIndex]: { id: `custom:${newId()}`, label: change.label },
    };
    next.nextIndex++;
  } else {
    if (
      !Number.isInteger(change.start) ||
      !Number.isInteger(change.count) ||
      change.start < 0 ||
      change.count < 1 ||
      change.start + change.count > axis.count
    )
      throw new Error('Invalid axis selection');
    const selected = axis.slice(change.start, change.count);
    if (change.type === 'resize') {
      if (!Number.isFinite(change.size)) throw new Error('Invalid axis size');
      if (change.count > 10000) throw new Error('Resize at most 10,000 items at once');
      const size = Math.round(
        Math.max(change.axis === 'rows' ? 24 : 48, Math.min(2000, change.size)),
      );
      next.sizes = { ...original.sizes };
      for (const span of selected)
        for (let index = span.start; index < span.start + span.count; index++)
          next.sizes[index] = size;
    } else if (change.type === 'hide')
      next.hidden = compactSpans([...original.hidden, ...selected]);
    else if (change.type === 'remove') {
      if (change.count > Object.keys(original.owned).length)
        throw new Error('Source items can be hidden, not removed');
      for (const span of selected)
        for (let index = span.start; index < span.start + span.count; index++)
          if (!original.owned[index]) throw new Error('Source items can be hidden, not removed');
      next.order = subtractSpans(original.order, selected);
    } else {
      if (!Number.isInteger(change.before) || change.before < 0 || change.before > axis.count)
        throw new Error('Invalid drop position');
      if (change.before >= change.start && change.before <= change.start + change.count)
        return state;
      const target = change.before === axis.count ? null : axis.canonicalAt(change.before);
      const remaining = subtractSpans(original.order, selected);
      const remainingAxis = new ViewAxis({ ...original, order: remaining });
      const position =
        target === null ? remainingAxis.logicalCount : remainingAxis.logicalIndex(target);
      next.order = compactSpans([
        ...sliceSpans(remaining, 0, position),
        ...selected,
        ...sliceSpans(remaining, position, remainingAxis.logicalCount - position),
      ]);
    }
  }
  const result = { ...state, [change.axis]: next, revision: state.revision + 1 };
  validateViewState(result);
  return result;
}
export class ViewController {
  private listeners = new Set<() => void>();
  rows: ViewAxis;
  columns: ViewAxis;
  constructor(
    private state: SheetViewState,
    private onChange?: (state: SheetViewState) => void,
  ) {
    validateViewState(state);
    this.rows = new ViewAxis(state.rows);
    this.columns = new ViewAxis(state.columns);
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  replace(next: SheetViewState) {
    validateViewState(next);
    if (
      next.sourceId !== this.state.sourceId ||
      next.viewId !== this.state.viewId ||
      next.sourceRows !== this.state.sourceRows ||
      next.sourceColumns !== this.state.sourceColumns
    )
      throw new Error('View belongs to a different source');
    this.state = { ...next, revision: this.state.revision + 1 };
    this.rows = new ViewAxis(this.state.rows);
    this.columns = new ViewAxis(this.state.columns);
    this.onChange?.(this.state);
    this.listeners.forEach((listener) => listener());
  }
  change(change: ViewChange) {
    const next = changeView(this.state, change);
    if (next !== this.state) this.replace(next);
  }
  canonical(address: { row: number; col: number }) {
    return { row: this.rows.canonicalAt(address.row), col: this.columns.canonicalAt(address.col) };
  }
  logical(address: { row: number; col: number }) {
    const ref = this.canonical(address);
    return { row: this.rows.logicalIndex(ref.row), col: this.columns.logicalIndex(ref.col) };
  }
}
