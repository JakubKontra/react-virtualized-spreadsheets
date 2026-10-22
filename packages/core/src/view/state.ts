import { SourceId, ViewId, ViewRevision } from '../brand';
import type { CellInput, Formula } from '../cell';
import { ColIndex, Index, type Axis, type AxisNameOf, type CellKey } from '../coords';
import type { ViewSettings } from '../features';
import type { DataSource } from '../source';
import type { OwnedItem, ViewAxisState } from './axis';

export type ViewAxes = { readonly [X in Axis]: ViewAxisState<AxisNameOf<X>> };

/**
 * A view is a persisted overlay on a source: order, visibility, sizes, inserted items,
 * cell overrides, calculated columns and presentation settings. All keys are canonical.
 */
export interface SheetViewState extends ViewSettings, ViewAxes {
  readonly schemaVersion: 1;
  readonly viewId: ViewId;
  readonly sourceId: SourceId;
  readonly sourceRows: number;
  readonly sourceColumns: number;
  readonly revision: ViewRevision;
  /** Inputs and formulas keyed by canonical `row:col`, independent of visual order. */
  readonly cells: Readonly<Record<CellKey, CellInput>>;
  /** Column formulas written for the first canonical row; `null` clears a source formula. */
  readonly columnFormulas: Readonly<Partial<Record<number, Formula | null>>>;
}

export interface PersistedView {
  readonly state: SheetViewState;
  /** Opaque token for optimistic concurrency. */
  readonly version: string;
}
export interface ViewSummary {
  readonly viewId: ViewId;
  readonly name: string;
  readonly sourceId: SourceId;
}
export interface ViewPersistenceAdapter {
  list?(sourceId: SourceId, signal: AbortSignal): Promise<ViewSummary[]>;
  load(viewId: ViewId, signal: AbortSignal): Promise<PersistedView | null>;
  save(
    state: SheetViewState,
    expectedVersion: string | null,
    signal: AbortSignal,
  ): Promise<PersistedView>;
}

export const newItemId = () =>
  `custom:${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;

export interface CreateViewStateOptions {
  readonly viewId: string;
  readonly sourceId: string;
  /** Source columns that behave as view-owned (editable, user-defined) columns. */
  readonly ownedColumns?: readonly number[] | undefined;
  /** Labels for owned columns, keyed by column index. */
  readonly labels?: Readonly<Partial<Record<number, string>>> | undefined;
}

export function createViewState(
  source: Pick<DataSource, 'metadata' | 'getColumnFormula'>,
  options: CreateViewStateOptions,
): SheetViewState {
  const axis = <A extends 'row' | 'col'>(
    count: number,
    owned: Partial<Record<number, OwnedItem>> = {},
  ): ViewAxisState<A> => ({
    order: [{ start: Index.unsafe<A, 'canonical'>(0), count }],
    hidden: [],
    sizes: {},
    owned,
    nextIndex: count,
  });
  const columnFormulas: Partial<Record<number, Formula>> = {};
  for (let col = 0; col < source.metadata.columns; col++) {
    const formula = source.getColumnFormula(ColIndex.unsafe(col));
    if (formula !== null) columnFormulas[col] = formula;
  }
  const owned: Partial<Record<number, OwnedItem>> = {};
  for (const col of options.ownedColumns ?? []) {
    const label = options.labels?.[col];
    owned[col] = { id: newItemId(), ...(label === undefined ? {} : { label }) };
  }
  return {
    schemaVersion: 1,
    viewId: ViewId.unsafe(options.viewId),
    sourceId: SourceId.unsafe(options.sourceId),
    sourceRows: source.metadata.rows,
    sourceColumns: source.metadata.columns,
    revision: ViewRevision.initial,
    rows: axis(source.metadata.rows),
    columns: axis(source.metadata.columns, owned),
    cells: {},
    columnFormulas,
  };
}
