import type { ColumnId, Revision, RowId } from './brand';
import type { CellPatch, CellRecord, ColumnFormulaPatch, Formula } from './cell';
import type { Address, CellRange, ColIndex, IndexSpace, RowIndex } from './coords';
import type { Unsubscribe } from './emitter';
import type { SheetViewState } from './view/state';
import type { ViewController } from './view/controller';

export interface SheetMetadata {
  readonly rows: number;
  readonly columns: number;
  readonly revision: Revision;
}

export interface DataBlock<S extends IndexSpace = 'visible'> {
  readonly range: CellRange<S>;
  readonly cells: readonly CellRecord<S>[];
  readonly revision: Revision;
}

/** A write is either a set of cell inputs or a set of calculated-column formulas, never both. */
export type Mutation =
  | { readonly kind: 'cells'; readonly cells: readonly CellPatch[] }
  | { readonly kind: 'columns'; readonly columns: readonly ColumnFormulaPatch[] };
export interface MutationResult {
  readonly revision: Revision;
}

/** Blocks of a view calculation, addressed by canonical row and column. */
export interface ViewBlocks {
  readonly blocks: readonly DataBlock<'canonical'>[];
  readonly revision: Revision;
}
/** Canonical row indices that match the view query, in display order. */
export interface ViewRows {
  readonly rows: Uint32Array;
  readonly revision: Revision;
}
export interface SelectionSummary {
  readonly count: number;
  readonly numericCount: number;
  readonly sum: number;
  readonly average: number | null;
  readonly min: number | null;
  readonly max: number | null;
  readonly revision: Revision;
}

export type ConnectionState = 'connected' | 'disconnected';
export type SourceEvent =
  | { readonly type: 'revision'; readonly revision: Revision; readonly mappingChanged?: boolean }
  | {
      readonly type: 'query';
      readonly revision: Revision;
      readonly querying: boolean;
      readonly mappingChanged?: boolean;
      readonly error?: string;
    }
  | {
      readonly type: 'connection';
      readonly revision: Revision;
      readonly connection: ConnectionState;
      readonly error?: string;
    }
  | { readonly type: 'error'; readonly revision: Revision; readonly error: string };

/** Whole-dataset calculations over a view overlay. Required to configure a view. */
export interface ViewCapability {
  query(view: SheetViewState, signal: AbortSignal): Promise<ViewRows>;
  summary(view: SheetViewState, range: CellRange, signal: AbortSignal): Promise<SelectionSummary>;
  blocks(
    view: SheetViewState,
    ranges: readonly CellRange<'canonical'>[],
    signal: AbortSignal,
  ): Promise<ViewBlocks>;
}

export type SourceMode = 'local' | 'remote';

export interface DataSource {
  readonly mode: SourceMode;
  readonly metadata: SheetMetadata;
  rowId(row: RowIndex): RowId;
  columnId(col: ColIndex): ColumnId;
  isEditable(address: Address): boolean;
  getBlock(range: CellRange, signal: AbortSignal): Promise<DataBlock>;
  mutate(mutation: Mutation, expected: Revision, signal: AbortSignal): Promise<MutationResult>;
  getColumnFormula(col: ColIndex): Formula | null;
  subscribe(listener: (event: SourceEvent) => void): Unsubscribe;
  dispose(): void;
  /** Summary of a selection computed by the source rather than from loaded cells. */
  readonly summary?: (range: CellRange, signal: AbortSignal) => Promise<SelectionSummary>;
  readonly views?: ViewCapability;
}
export type ViewCapableSource = DataSource & { readonly views: ViewCapability };
/** A source presented through a view: visible indices map to canonical identities. */
export type ViewedSource = DataSource & {
  readonly view: ViewController;
  readonly summary: NonNullable<DataSource['summary']>;
};

export const hasViews = (source: DataSource): source is ViewCapableSource => !!source.views;
export const isViewed = (source: DataSource): source is ViewedSource =>
  'view' in source && source.view !== undefined;

export interface CalculationAdapter {
  calculate(range: CellRange, signal: AbortSignal): Promise<DataBlock>;
  apply(mutation: Mutation, expected: Revision, signal: AbortSignal): Promise<MutationResult>;
  readonly views?: ViewCapability;
  dispose(): void;
}
/** A calculator that can also evaluate view overlays; its local source is view-capable. */
export type ViewCapableCalculator = CalculationAdapter & { readonly views: ViewCapability };
