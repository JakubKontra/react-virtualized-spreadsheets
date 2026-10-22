import { keysOf } from '../assert';
import { ViewRevision, type Revision } from '../brand';
import {
  isFormula,
  type CellInput,
  type CellPatch,
  type CellSnapshot,
  type Formula,
} from '../cell';
import { copyRange, pasteCells, type ClipboardData, type PasteOptions } from '../clipboard';
import {
  Address,
  axisName,
  CellRange,
  cellKey,
  ColIndex,
  LogicalCol,
  LogicalRow,
  parseA1,
  RowIndex,
  addressLabel,
  sameSpace,
  type Axis,
  type AxisIndex,
  type CanonicalAddress,
  type LogicalAddress,
} from '../coords';
import { Emitter, type Unsubscribe } from '../emitter';
import { errorMessage, SheetError } from '../errors';
import {
  createFillPatches,
  parseTypedInput,
  type ColumnOptions,
  type ViewSettings,
} from '../features';
import { LIMITS } from '../limits';
import { isViewed, type DataSource, type Mutation, type ViewCapableSource } from '../source';
import {
  createViewSource,
  mapViewFormula,
  ViewAxis,
  ViewController,
  type SheetViewState,
  type ViewChange,
} from '../view';
import { BlockCache, type CacheOptions, type CacheStats } from './block-cache';
import { columnTemplate, planCellEdit, planColumnEdit, uniquePatches } from './edit-plan';
import { History, type HistoryEntry } from './history';
import type { EditorTarget, SpreadsheetState } from './state';

export interface ViewOptions {
  readonly state: SheetViewState;
  readonly onChange?: ((state: SheetViewState) => void) | undefined;
}
export type SpreadsheetOptions = CacheOptions & {
  /** Undo depth (default 100). */
  readonly historyLimit?: number | undefined;
} & (
    | { readonly source: DataSource; readonly view?: undefined }
    | {
        /** A view needs whole-dataset calculations, so the source must implement `views`. */
        readonly source: ViewCapableSource;
        readonly view: ViewOptions;
      }
  );

/** Result of committing a draft: whether anything was written. */
export type CommitResult = 'committed' | 'unchanged';

interface QueryAnchor {
  readonly active: CanonicalAddress;
  readonly editing: CanonicalAddress | null;
  readonly start: CanonicalAddress;
  readonly end: CanonicalAddress;
}

const ORIGIN = Address.unsafe(0, 0);

export function createSpreadsheet(options: SpreadsheetOptions): SpreadsheetStore {
  return new SpreadsheetStore(options);
}

/**
 * Framework-agnostic spreadsheet state: selection, editing, a bounded block cache,
 * undo/redo and clipboard. Addresses are visible positions.
 */
export class SpreadsheetStore {
  readonly source: DataSource;
  readonly view: ViewController | undefined;
  private cache: BlockCache;
  private emitter = new Emitter();
  private history: History;
  private clipboard: ClipboardData | null = null;
  private clipboardToken = '';
  private viewport: CellRange[] = [];
  private queryAnchor: QueryAnchor | null = null;
  private disposed = false;
  private mutationController: AbortController | null = null;
  private unsubscribe: Unsubscribe;
  private state: SpreadsheetState;
  constructor(options: SpreadsheetOptions) {
    if (options.view) {
      const viewed = createViewSource(
        options.source,
        new ViewController(options.view.state, options.view.onChange),
      );
      this.source = viewed;
      this.view = viewed.view;
    } else {
      this.source = options.source;
      this.view = isViewed(options.source) ? options.source.view : undefined;
    }
    this.history = new History(options.historyLimit);
    const store = this;
    this.cache = new BlockCache(
      {
        get rows() {
          return store.rows;
        },
        get columns() {
          return store.columns;
        },
        get revision() {
          return store.state.revision;
        },
        get disposed() {
          return store.disposed;
        },
        read: (range, signal) => this.source.getBlock(range, signal),
        onNewerRevision: (revision) => this.invalidate(revision),
        onError: (error) => this.setError(error),
        onLoading: (loading) => this.update({ loading }),
      },
      options,
    );
    this.state = {
      selection: CellRange.of(ORIGIN),
      selectionKind: 'cells',
      active: ORIGIN,
      draft: null,
      editor: 'cell',
      viewRevision: this.view?.getSnapshot().revision ?? ViewRevision.initial,
      editing: null,
      connection: 'connected',
      pending: false,
      querying: false,
      loading: 0,
      error: null,
      canUndo: false,
      canRedo: false,
      revision: this.source.metadata.revision,
    };
    this.unsubscribe = this.source.subscribe((event) => {
      if (this.disposed) return;
      switch (event.type) {
        case 'query':
          if (event.querying && !this.state.querying && this.view && this.rows)
            this.queryAnchor = {
              active: this.view.canonical(this.state.active),
              editing: this.state.editing ? this.view.canonical(this.state.editing) : null,
              start: this.view.canonical(this.state.selection.start),
              end: this.view.canonical(this.state.selection.end),
            };
          this.update({ querying: event.querying });
          if (event.error) this.update({ error: event.error });
          break;
        case 'connection':
          this.update({ connection: event.connection });
          if (event.error) this.update({ error: event.error });
          break;
        case 'error':
          this.update({ error: event.error });
          break;
        case 'revision':
          break;
      }
      if (event.revision > this.state.revision)
        this.invalidate(event.revision, 'mappingChanged' in event && !!event.mappingChanged);
    });
  }

  /** Visible rows. Zero while a query matches nothing. */
  get rows(): number {
    return this.source.metadata.rows;
  }
  /** Visible columns. */
  get columns(): number {
    return this.source.metadata.columns;
  }
  get blockRows(): number {
    return this.cache.blockRows;
  }
  get blockColumns(): number {
    return this.cache.blockColumns;
  }

  /** The A1 position of a visible address: logical when a view hides or reorders items. */
  logicalAddress(address: Address): LogicalAddress {
    const view = this.view;
    if (!view) return sameSpace(address);
    if (this.rows) return view.logical(address);
    // An empty query result still has columns: keep their logical positions.
    return {
      row: LogicalRow.unsafe(0),
      col:
        view.columns.logicalIndex(view.columns.canonicalAt(address.col)) ??
        LogicalCol.unsafe(address.col),
    };
  }
  labelAddress(address: Address): string {
    return addressLabel(this.logicalAddress(address));
  }
  /** Visible address of an A1 label, or `null` when it is invalid or hidden. */
  resolveAddress(label: string): Address | null {
    if (!this.view) return parseA1(label);
    const logical = parseA1<'logical'>(label);
    return (logical && this.view.fromLogical(logical)) ?? null;
  }

  getSnapshot = (): SpreadsheetState => this.state;
  subscribe = (listener: () => void): Unsubscribe => this.emitter.subscribe(listener);
  subscribeCell(address: Address, listener: () => void): Unsubscribe {
    return this.cache.cells.subscribe(cellKey(address), listener);
  }
  readCell = (address: Address): CellSnapshot => this.cache.read(address);
  get cacheStats(): CacheStats {
    return this.cache.stats;
  }

  private update(patch: Partial<SpreadsheetState>) {
    if (this.disposed) return;
    if (keysOf(patch).every((key) => Object.is(this.state[key], patch[key]))) return;
    this.state = { ...this.state, ...patch };
    this.emitter.emit();
  }

  async ensureRange(range: CellRange) {
    this.assertAddress(range.start);
    this.assertAddress(range.end);
    const refs = this.cache.refs(range);
    if (refs.length > this.cache.maxBlocks)
      throw new SheetError(
        'LIMIT_EXCEEDED',
        'Requested range exceeds the client cache; use smaller batches',
      );
    // A read can discover a newer source revision before its SSE event arrives.
    // In that case fetch again so callers can safely edit the loaded targets.
    for (let attempt = 0; attempt < 3; attempt++) {
      const revision = this.state.revision;
      await Promise.all(refs.map((ref) => this.cache.fetch(ref)));
      if (this.disposed || revision === this.state.revision) return;
    }
    throw new SheetError('BUSY', 'The sheet changed while loading. Try again.');
  }
  setViewport(range: CellRange) {
    this.setViewports([range]);
  }
  setViewports(ranges: readonly CellRange[]) {
    if (this.disposed) return;
    this.viewport = this.rows ? [...ranges] : [];
    if (this.state.querying) return;
    const refs = new Map(
      this.viewport.flatMap((range) => this.cache.refs(range)).map((ref) => [ref.key, ref]),
    );
    this.cache.retain(new Set(refs.keys()));
    if (refs.size > this.cache.maxBlocks) {
      this.setError('Viewport exceeds cache capacity');
      return;
    }
    void Promise.all([...refs.values()].map((ref) => this.cache.fetch(ref))).catch(
      (error: unknown) => this.setError(error),
    );
  }
  private clampAddress(address: Address): Address {
    return {
      row: RowIndex.clamp(address.row, this.rows),
      col: ColIndex.unsafe(Math.min(address.col, this.columns - 1)),
    };
  }
  private invalidate(revision: Revision, mappingChanged = false) {
    this.cache.invalidate(mappingChanged);
    if (mappingChanged) {
      this.viewport = this.rows
        ? this.viewport.map((range) => ({
            start: this.clampAddress(range.start),
            end: this.clampAddress(range.end),
          }))
        : [];
      const anchor = this.queryAnchor;
      const visible = (address: CanonicalAddress | null | undefined) =>
        address && this.view ? (this.view.visible(address) ?? null) : null;
      const active = visible(anchor?.active) ?? this.clampAddress(this.state.active);
      const editing =
        anchor?.editing && this.state.editing ? visible(anchor.editing) : this.state.editing;
      const lostDraft = !!anchor?.editing && !editing && this.state.draft !== null;
      if (!this.state.querying) this.queryAnchor = null;
      this.update({
        ...(anchor
          ? {
              editing,
              draft: lostDraft ? null : this.state.draft,
              ...(lostDraft
                ? {
                    error: `The edited row no longer matches the query. Unsaved draft: ${this.state.draft}`,
                  }
                : {}),
            }
          : {}),
        active,
        selection: {
          start: visible(anchor?.start) ?? this.clampAddress(this.state.selection.start),
          end: visible(anchor?.end) ?? this.clampAddress(this.state.selection.end),
        },
        viewRevision: this.view?.getSnapshot().revision ?? ViewRevision.initial,
      });
    }
    this.update({ revision, loading: 0 });
    this.setViewports(this.viewport);
  }
  refresh() {
    this.invalidate(this.source.metadata.revision);
  }
  isInside(address: Address): boolean {
    return (
      Number.isInteger(address.row) &&
      Number.isInteger(address.col) &&
      address.row >= 0 &&
      address.col >= 0 &&
      address.row < this.rows &&
      address.col < this.columns
    );
  }
  assertAddress(address: Address) {
    if (!this.isInside(address))
      throw new SheetError('OUT_OF_BOUNDS', 'Address is outside the sheet');
  }

  select(address: Address, extend = false) {
    if (this.state.querying) return;
    this.assertAddress(address);
    this.update({
      selection: { start: extend ? this.state.selection.start : address, end: address },
      editing: null,
      draft: null,
      active: address,
      selectionKind: 'cells',
    });
  }
  selectAxis<X extends Axis>(axis: X, index: AxisIndex<X>, extend = false) {
    if (this.state.querying) return;
    const coordinate = axisName(axis);
    if (!this.rows) {
      if (coordinate === 'col' && index >= 0 && index < this.columns) {
        const address = Address.unsafe(0, index);
        this.update({
          active: address,
          selection: CellRange.of(address),
          selectionKind: 'columns',
          editing: null,
          draft: null,
        });
      }
      return;
    }
    const anchor: number =
      extend && this.state.selectionKind === axis ? this.state.selection.start[coordinate] : index;
    const start = coordinate === 'row' ? Address.unsafe(anchor, 0) : Address.unsafe(0, anchor);
    const end =
      coordinate === 'row'
        ? Address.unsafe(index, this.columns - 1)
        : Address.unsafe(this.rows - 1, index);
    this.assertAddress(start);
    this.assertAddress(end);
    this.update({
      selection: { start, end },
      active:
        coordinate === 'row'
          ? Address.unsafe(index, this.state.active.col)
          : Address.unsafe(this.state.active.row, index),
      selectionKind: axis,
      editing: null,
      draft: null,
    });
  }
  selectAll() {
    if (!this.rows || this.state.querying) return;
    this.update({
      selection: CellRange.unsafe(0, 0, this.rows - 1, this.columns - 1),
      selectionKind: 'all',
      editing: null,
      draft: null,
    });
  }

  beginEdit(address: Address = this.state.active, initial?: string, editor: EditorTarget = 'cell') {
    if (
      initial === undefined &&
      this.state.editing &&
      Address.equals(this.state.editing, address)
    ) {
      this.update({ editor });
      return;
    }
    if (!this.source.isEditable(address)) {
      this.setError(
        new SheetError('READ_ONLY', 'Source data is read-only. Edit a calculated column.'),
      );
      return;
    }
    const cell = this.readCell(address);
    if (cell.status === 'loading' || cell.status === 'calculating' || this.state.pending) return;
    this.update({
      editing: address,
      draft: initial ?? String(cell.input ?? ''),
      editor,
      error: null,
    });
  }
  setDraft(draft: string) {
    if (this.state.editing) this.update({ draft });
  }
  cancelEdit() {
    this.update({ editing: null, draft: null });
  }
  /**
   * Writes typed text to a cell, parsing it by the column's kind. On a remote source without a
   * view, the text becomes the formula template of a calculated column.
   */
  async commitDraft(
    text: string = this.state.draft ?? '',
    address: Address = this.state.editing ?? this.state.active,
  ): Promise<CommitResult> {
    if (String(this.readCell(address).input ?? '') === text) {
      this.cancelEdit();
      return 'unchanged';
    }
    const status = this.readCell(address).status;
    if (status === 'loading' || status === 'calculating')
      await this.ensureRange(CellRange.of(address));
    const input = this.parseInput(text, address);
    if (this.source.mode === 'remote' && !this.view)
      await this.setColumnFormula(address.col, columnTemplate(input, address));
    else await this.edit([{ ...address, input }]);
    return 'committed';
  }

  private rebaseClipboard(before: SheetViewState, after: SheetViewState) {
    const clipboard = this.clipboard;
    if (!clipboard?.positions || (before.rows === after.rows && before.columns === after.columns))
      return;
    const oldRows = new ViewAxis(before.rows);
    const oldColumns = new ViewAxis(before.columns);
    const rows = new ViewAxis(after.rows);
    const columns = new ViewAxis(after.columns);
    const positions: LogicalAddress[][] = [];
    for (const line of clipboard.positions) {
      const mapped: LogicalAddress[] = [];
      for (const position of line) {
        const row = rows.logicalIndex(oldRows.canonicalAtLogical(position.row));
        const col = columns.logicalIndex(oldColumns.canonicalAtLogical(position.col));
        if (row === undefined || col === undefined) {
          this.clipboard = null;
          this.clipboardToken = '';
          return;
        }
        mapped.push({ row, col });
      }
      positions.push(mapped);
    }
    const origin = positions[0]?.[0];
    if (!origin) return;
    const inputs = clipboard.inputs.map((line) =>
      line.map((input): CellInput =>
        isFormula(input)
          ? mapViewFormula(mapViewFormula(input, before, 'bind'), after, 'display')
          : input,
      ),
    );
    this.clipboard = { ...clipboard, inputs, positions, origin };
  }
  private requireView(message: string): ViewController {
    if (!this.view) throw new SheetError('UNSUPPORTED', message);
    return this.view;
  }
  /** Reselects the previously active item after a view change, or the nearest position. */
  private restoreActive(view: ViewController, active: CanonicalAddress | null) {
    if (!this.rows) return;
    const visible = active ? view.visible(active) : undefined;
    this.select(
      Address.unsafe(
        visible?.row ?? Math.min(this.state.active.row, this.rows - 1),
        visible?.col ?? Math.min(this.state.active.col, this.columns - 1),
      ),
    );
  }
  private replaceView(next: SheetViewState) {
    const view = this.requireView('Configure a view to change it');
    const active = this.rows ? view.canonical(this.state.active) : null;
    const before = view.getSnapshot();
    view.replace(next);
    this.rebaseClipboard(before, view.getSnapshot());
    this.restoreActive(view, active);
  }
  setViewState(next: SheetViewState) {
    this.replaceView(next);
  }
  changeView(change: ViewChange) {
    const view = this.requireView('Configure a view to change it');
    if (this.state.editing || this.state.pending)
      throw new SheetError('BUSY', 'Finish editing before changing the view');
    const before = view.getSnapshot();
    const active = this.rows ? view.canonical(this.state.active) : null;
    view.change(change);
    const after = view.getSnapshot();
    if (before === after) return;
    this.rebaseClipboard(before, after);
    this.restoreActive(view, active);
    this.record({ kind: 'view', before, after });
  }
  configure(settings: ViewSettings) {
    const view = this.requireView('Configure a view to save settings');
    if (this.state.editing || this.state.pending)
      throw new SheetError('BUSY', 'Finish editing before changing settings');
    const before = view.getSnapshot();
    this.clearError();
    view.replace({ ...before, ...settings });
    this.record({ kind: 'view', before, after: view.getSnapshot() });
  }
  columnOptions(col: ColIndex): ColumnOptions | undefined {
    const view = this.view;
    return view?.getSnapshot().columnOptions?.[view.columns.canonicalAt(col)];
  }
  parseInput(text: string, address: Address = this.state.active): CellInput {
    return parseTypedInput(text, this.columnOptions(address.col));
  }
  async fill(target: CellRange, source: CellRange = this.state.selection) {
    target = CellRange.normalize(target);
    source = CellRange.normalize(source);
    this.assertAddress(target.start);
    this.assertAddress(target.end);
    if (CellRange.size(target) > LIMITS.maxEditCells)
      throw new SheetError('LIMIT_EXCEEDED', 'Fill at most 10,000 cells');
    const revision = this.state.revision;
    await this.ensureRange(target);
    if (revision !== this.state.revision)
      throw new SheetError('REVISION_CONFLICT', 'The sheet changed while preparing fill');
    const patches = createFillPatches(
      source,
      target,
      (a) => this.readCell(a).input,
      (a) => this.logicalAddress(a),
    );
    if (patches.length) await this.edit(patches);
    this.select(target.start);
    this.select(target.end, true);
  }
  setError(error: unknown) {
    this.update({ error: errorMessage(error) });
  }
  clearError() {
    this.update({ error: null });
  }
  private async perform(mutation: Mutation) {
    if (this.disposed) throw new SheetError('DISPOSED', 'Spreadsheet is disposed');
    if (this.state.pending) throw new SheetError('BUSY', 'Wait for the current change to finish');
    if (this.state.connection === 'disconnected')
      throw new SheetError('DISCONNECTED', 'Reconnect before editing');
    this.update({ pending: true, error: null });
    const controller = new AbortController();
    this.mutationController = controller;
    try {
      const result = await this.source.mutate(mutation, this.state.revision, controller.signal);
      if (this.disposed) return;
      if (result.revision > this.state.revision) this.invalidate(result.revision);
      this.update({ editing: null, draft: null });
    } catch (error) {
      this.setError(error);
      throw error;
    } finally {
      this.mutationController = null;
      this.update({ pending: false });
    }
  }
  private assertEditable(patch: Address) {
    this.assertAddress(patch);
    if (!this.source.isEditable(patch))
      throw new SheetError('READ_ONLY', 'This range contains read-only cells');
  }
  async edit(patches: readonly CellPatch[]) {
    if (patches.length > LIMITS.maxEditCells)
      throw new SheetError('LIMIT_EXCEEDED', 'Maximum edit size is 10,000 cells');
    const unique = uniquePatches(patches);
    const view = this.view;
    const before = view?.getSnapshot();
    unique.forEach((patch) => this.assertEditable(patch));
    const plan =
      this.source.mode === 'remote' && !view
        ? planColumnEdit(unique, (col) => this.source.getColumnFormula(col))
        : planCellEdit(unique, this.readCell);
    await this.perform(plan.forward);
    this.record(
      view && before
        ? { kind: 'view', before, after: view.getSnapshot() }
        : { kind: 'data', ...plan },
    );
  }
  async setColumnFormula(col: ColIndex, formula: Formula | null) {
    const view = this.view;
    const before = view?.getSnapshot();
    this.assertAddress(Address.unsafe(0, col));
    if (!this.source.isEditable(Address.unsafe(0, col)))
      throw new SheetError('READ_ONLY', 'This column is read-only');
    const forward: Mutation = { kind: 'columns', columns: [{ col, formula }] };
    const backward: Mutation = {
      kind: 'columns',
      columns: [{ col, formula: this.source.getColumnFormula(col) }],
    };
    await this.perform(forward);
    this.record(
      view && before
        ? { kind: 'view', before, after: view.getSnapshot() }
        : { kind: 'data', forward, backward },
    );
  }
  private record(entry: HistoryEntry) {
    if (this.disposed) return;
    this.history.record(entry);
    this.historyState();
  }
  private historyState() {
    this.update({ canUndo: this.history.canUndo, canRedo: this.history.canRedo });
  }
  async undo() {
    if (this.state.pending || this.state.editing)
      throw new SheetError('BUSY', 'Finish editing before undo');
    const entry = this.history.peekUndo();
    if (!entry) return;
    if (entry.kind === 'view') this.replaceView(entry.before);
    else await this.perform(entry.backward);
    this.history.commitUndo();
    this.historyState();
  }
  async redo() {
    if (this.state.pending || this.state.editing)
      throw new SheetError('BUSY', 'Finish editing before redo');
    const entry = this.history.peekRedo();
    if (!entry) return;
    if (entry.kind === 'view') this.replaceView(entry.after);
    else await this.perform(entry.forward);
    this.history.commitRedo();
    this.historyState();
  }
  copy(): string {
    this.clipboard = copyRange(this.state.selection, this.readCell, (address) =>
      this.logicalAddress(address),
    );
    this.clipboardToken = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}:${Math.random()}`;
    return this.clipboard.tsv;
  }
  getClipboardToken(): string {
    return this.clipboardToken;
  }
  /** Pass `false` (or `useInternalFormulas: false`) for text whose clipboard token did not match. */
  async paste(text: string, options: boolean | PasteOptions = true) {
    const settings: PasteOptions =
      typeof options === 'boolean' ? { useInternalFormulas: options } : options;
    const revision = this.state.revision;
    const viewRevision = this.state.viewRevision;
    const patches = pasteCells(
      text,
      CellRange.normalize(this.state.selection).start,
      this.clipboard,
      (address) => {
        this.assertAddress(address);
        return this.logicalAddress(address);
      },
      settings,
    );
    if (!patches.length) return;
    for (const patch of patches) this.assertAddress(patch);
    if (this.source.mode === 'local' || this.view)
      await this.ensureRange(
        CellRange.unsafe(
          Math.min(...patches.map((p) => p.row)),
          Math.min(...patches.map((p) => p.col)),
          Math.max(...patches.map((p) => p.row)),
          Math.max(...patches.map((p) => p.col)),
        ),
      );
    if (revision !== this.state.revision || viewRevision !== this.state.viewRevision)
      throw new SheetError(
        'REVISION_CONFLICT',
        'The sheet changed while preparing paste; try again',
      );
    await this.edit(patches);
  }
  async clearSelection() {
    const range = CellRange.normalize(this.state.selection);
    if (this.source.mode === 'remote' && !this.view) {
      await this.edit(
        Array.from({ length: CellRange.columns(range) }, (_, offset) => ({
          ...Address.offset(range.start, 0, offset),
          input: null,
        })),
      );
      return;
    }
    if (CellRange.size(range) > LIMITS.maxEditCells)
      throw new SheetError('LIMIT_EXCEEDED', 'Maximum edit size is 10,000 cells');
    await this.ensureRange(range);
    const patches: CellPatch[] = [];
    for (let row = range.start.row; row <= range.end.row; row++)
      for (let col = range.start.col; col <= range.end.col; col++)
        patches.push({ ...Address.unsafe(row, col), input: null });
    await this.edit(patches);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    this.mutationController?.abort();
    this.source.dispose();
    this.cache.dispose();
    this.emitter.clear();
    this.history.clear();
    this.clipboard = null;
  }
}
