import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  Key,
  RefObject,
} from 'react';
import type {
  Address,
  Axis,
  AxisIndex,
  CanonicalCol,
  CellRange,
  ColIndex,
  FormulaDiagnostic,
  FormulaEditingAnalysis,
  FormulaFunction,
  RowIndex,
  SelectionSummary,
  SpreadsheetState,
  SpreadsheetStore,
  ViewChange,
} from '@sheet/core';
import type { CellRect } from './internal/geometry';
import type { FormulaReference } from './internal/formula-references';

export type { CellRect } from './internal/geometry';
export type { FormulaReference, ReferenceColor } from './internal/formula-references';

export interface UseSpreadsheetOptions {
  readonly store: SpreadsheetStore;
  readonly scrollRef: RefObject<HTMLElement | null>;
  /** Default row height in pixels (32). */
  readonly rowHeight?: number | undefined;
  /** Default width of a column, by canonical column (120). */
  readonly columnWidth?: ((col: CanonicalCol) => number) | undefined;
  readonly rowHeaderWidth?: number | undefined;
  readonly columnHeaderHeight?: number | undefined;
}

/** A rendered row or column, with an index branded for its axis. */
export interface VirtualAxisItem<I extends number> {
  readonly key: Key;
  readonly index: I;
  readonly start: number;
  readonly size: number;
  readonly end: number;
}
export type VirtualRow = VirtualAxisItem<RowIndex>;
export type VirtualColumn = VirtualAxisItem<ColIndex>;

export interface GridLayout {
  readonly virtualRows: readonly VirtualRow[];
  readonly virtualColumns: readonly VirtualColumn[];
  readonly totalWidth: number;
  readonly totalHeight: number;
  /** Rows pinned to the top; a count, not an index. */
  readonly frozenRows: number;
  /** Columns pinned to the left; a count, not an index. */
  readonly frozenColumns: number;
  /** Rendered offset of a row, keeping frozen rows in place while scrolling. */
  displayRow(index: RowIndex, start: number): number;
  /** Rendered offset of a column, keeping frozen columns in place while scrolling. */
  displayColumn(index: ColIndex, start: number): number;
  cellRect(address: Address): CellRect;
}

export interface StartEditOptions {
  /** Replace the cell content with this text (typing over a cell). */
  readonly initial?: string | undefined;
  /** Cell to edit; defaults to the active cell. */
  readonly address?: Address | undefined;
}
export type CommitMove = 'down' | 'left' | 'right' | 'none';
export interface CommitEditOptions {
  /** Text to commit; defaults to the current draft. */
  readonly text?: string | undefined;
  /** Where the active cell goes after a successful commit (default `'none'`). */
  readonly move?: CommitMove | undefined;
  /** Return focus to the grid (default `true`). */
  readonly restoreFocus?: boolean | undefined;
}
export interface EditSession {
  readonly draft: string;
  setDraft(value: string): void;
  start(options?: StartEditOptions): void;
  /** Resolves `false` when the commit failed; the error is reported on the store. */
  commit(options?: CommitEditOptions): Promise<boolean>;
  cancel(): void;
}
export interface Navigation {
  /** Commits a pending edit first, then selects and scrolls. */
  select(address: Address, options?: { readonly extend?: boolean | undefined }): void;
  scrollToCell(address: Address): void;
}

export type GridProps = HTMLAttributes<HTMLElement> & {
  readonly role: 'grid';
  readonly tabIndex: 0;
  readonly 'aria-rowcount': number;
  readonly 'aria-colcount': number;
};
export type CellProps = HTMLAttributes<HTMLElement> & {
  readonly id: string;
  readonly role: 'gridcell';
  /** A1 label, logical when a view is configured. */
  readonly 'data-address': string;
};
export type EditorProps = InputHTMLAttributes<HTMLInputElement> & {
  readonly 'data-sheet-editor': string;
  readonly value: string;
};
export type FillHandleProps = Pick<
  ButtonHTMLAttributes<HTMLElement>,
  'aria-label' | 'onPointerDown' | 'onKeyDown'
>;
export interface PropGetters {
  readonly grid: GridProps;
  cell(address: Address): CellProps;
  readonly editor: EditorProps;
  readonly formulaBar: EditorProps;
  readonly fillHandle: FillHandleProps;
}

export type SelectionSummaryState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly value: SelectionSummary }
  | { readonly status: 'error'; readonly error: string };

export type FunctionHelp = FormulaFunction & {
  /** 1-based argument the caret is in. */
  readonly argument: number;
};
/** Picks a range into the formula draft by pointing at cells. */
export interface ReferencePick {
  update(range: CellRange): void;
  cancel(): void;
}
export interface FormulaEditorController extends FormulaEditingAnalysis {
  readonly diagnostics: readonly FormulaDiagnostic[];
  readonly suggestions: readonly FormulaFunction[];
  /** Highlighted suggestion. */
  readonly selected: number;
  readonly references: readonly FormulaReference[];
  readonly help: FunctionHelp | null;
  referenceColor(address: Address): string | undefined;
  toggleAbsoluteReference(): void;
  track(event: { readonly currentTarget: HTMLInputElement }): void;
  /** Returns `true` when the key was handled by the formula editor. */
  onKeyDown(event: import('react').KeyboardEvent<HTMLInputElement>): boolean;
  accept(index?: number): void;
  /** Starts point mode when the caret is where an operand is expected. */
  pick(): ReferencePick | null;
}

/** A context menu on a row or column header. */
export type HeaderMenu = {
  readonly [X in Axis]: {
    readonly axis: X;
    readonly index: AxisIndex<X>;
    readonly x: number;
    readonly y: number;
  };
}[Axis];
export interface DropLine {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}
export interface DragPreview {
  readonly kind: 'move' | 'resize';
  readonly axis: Axis;
  readonly start: number;
  readonly count: number;
  /** Visible position the moved items land before. */
  readonly before: number;
  readonly size: number;
  readonly x: number;
  readonly y: number;
  readonly line: DropLine;
}
/** A run of selected headers on one axis. */
export interface AxisSelection {
  readonly start: number;
  readonly count: number;
}
export interface SheetGestures {
  readonly preview: DragPreview | null;
  readonly menu: HeaderMenu | null;
  /** Polite live-region text describing the last structural change. */
  readonly announcement: string;
  closeMenu(): void;
  openMenu<X extends Axis>(axis: X, index: AxisIndex<X>, x: number, y: number): Promise<void>;
  /** Commits a pending edit, applies a view change and reports errors on the store. */
  run(change: ViewChange): Promise<boolean>;
  selection<X extends Axis>(axis: X, index: AxisIndex<X>): AxisSelection;
  headerProps<X extends Axis>(axis: X, index: AxisIndex<X>): HTMLAttributes<HTMLElement>;
  dragProps<X extends Axis>(axis: X, index: AxisIndex<X>): HTMLAttributes<HTMLElement>;
  resizeProps<X extends Axis>(axis: X, index: AxisIndex<X>): HTMLAttributes<HTMLElement>;
  startSelection(event: import('react').PointerEvent): void;
}

export interface SpreadsheetController {
  readonly state: SpreadsheetState;
  /** Normalized selection. */
  readonly selection: CellRange;
  readonly layout: GridLayout;
  readonly edit: EditSession;
  readonly navigation: Navigation;
  readonly props: PropGetters;
  readonly formula: FormulaEditorController;
  readonly summary: SelectionSummaryState;
  readonly gestures: SheetGestures;
  /** Range a fill-handle or reference drag currently covers. */
  readonly fillPreview: CellRange | null;
}
