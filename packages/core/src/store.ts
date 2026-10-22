import { copyRange, pasteCells, type ClipboardData } from './clipboard';
import { shiftFormula } from './formula';
import { ViewAxis, ViewController, type Axis, type SheetViewState, type ViewChange } from './view';
import { mapViewFormula } from './view-formula';
import { createViewSource } from './view-source';
import {
  cellKey,
  addressLabel,
  parseAddress,
  normalizeRange,
  type Address,
  type CellPatch,
  type CellRange,
  type CellSnapshot,
  type DataSource,
  type Mutation,
} from './types';

const EMPTY: CellSnapshot = Object.freeze({ input: null, value: null, status: 'loading' });
type Listener = () => void;
interface Block {
  cells: Map<string, CellSnapshot>;
  revision: number;
}
type HistoryEntry =
  | {
      forward: Mutation;
      backward: Mutation;
    }
  | { beforeView: SheetViewState; afterView: SheetViewState };
export interface SpreadsheetState {
  selection: CellRange;
  selectionKind: 'cells' | 'rows' | 'columns' | 'all';
  active: Address;
  editing: Address | null;
  draft: string | null;
  editor: 'cell' | 'bar';
  viewRevision: number;
  connection: 'connected' | 'disconnected';
  pending: boolean;
  loading: number;
  error: string | null;
  canUndo: boolean;
  canRedo: boolean;
  revision: number;
}
export interface SpreadsheetOptions {
  source: DataSource;
  viewState?: SheetViewState;
  onViewStateChange?: (state: SheetViewState) => void;
  blockRows?: number;
  blockColumns?: number;
  maxBlocks?: number;
  historyLimit?: number;
}
export function createSpreadsheet(options: SpreadsheetOptions) {
  return new SpreadsheetStore(options);
}

export class SpreadsheetStore {
  readonly source: DataSource;
  readonly blockRows: number;
  readonly blockColumns: number;
  private maxBlocks: number;
  private blocks = new Map<string, Block>();
  private flights = new Map<string, { controller: AbortController; promise: Promise<void> }>();
  private listeners = new Set<Listener>();
  private cells = new Map<string, Set<Listener>>();
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private clipboard: ClipboardData | null = null;
  private clipboardToken = '';
  private viewport: CellRange | null = null;
  private generation = 0;
  private disposed = false;
  private mutationController: AbortController | null = null;
  private unsubscribe: () => void;
  private state: SpreadsheetState;
  constructor(private options: SpreadsheetOptions) {
    this.source = options.viewState
      ? createViewSource(
          options.source,
          new ViewController(options.viewState, options.onViewStateChange),
        )
      : options.source;
    this.blockRows = options.blockRows ?? 64;
    this.blockColumns = options.blockColumns ?? 8;
    this.maxBlocks = options.maxBlocks ?? 48;
    if (
      this.blockRows * this.blockColumns > 20000 ||
      this.blockRows < 1 ||
      this.blockColumns < 1 ||
      this.maxBlocks < 1
    )
      throw new Error('Invalid cache configuration');
    this.state = {
      selection: { start: { row: 0, col: 0 }, end: { row: 0, col: 0 } },
      selectionKind: 'cells',
      active: { row: 0, col: 0 },
      draft: null,
      editor: 'cell',
      viewRevision: this.source.view?.getSnapshot().revision ?? 0,
      editing: null,
      connection: 'connected',
      pending: false,
      loading: 0,
      error: null,
      canUndo: false,
      canRedo: false,
      revision: this.source.metadata.revision,
    };
    this.unsubscribe = this.source.subscribe((event) => {
      if (this.disposed) return;
      if (event.connection) this.update({ connection: event.connection });
      if (event.error) this.update({ error: event.error });
      if (event.revision > this.state.revision)
        this.invalidate(event.revision, event.mappingChanged);
    });
  }
  get rows() {
    return this.source.metadata.rows;
  }
  get view() {
    return this.source.view;
  }
  logicalAddress(address: Address) {
    return this.view?.logical(address) ?? address;
  }
  labelAddress(address: Address) {
    return addressLabel(this.logicalAddress(address));
  }
  resolveAddress(label: string): Address | null {
    const address = parseAddress(label);
    if (!address || !this.view) return address;
    try {
      const row = this.view.rows.visibleIndex(this.view.rows.canonicalAtLogical(address.row));
      const col = this.view.columns.visibleIndex(this.view.columns.canonicalAtLogical(address.col));
      return row < 0 || col < 0 ? null : { row, col };
    } catch {
      return null;
    }
  }
  get columns() {
    return this.source.metadata.columns;
  }
  getSnapshot = () => this.state;
  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  subscribeCell(address: Address, listener: Listener) {
    const key = cellKey(address);
    let listeners = this.cells.get(key);
    if (!listeners) this.cells.set(key, (listeners = new Set()));
    listeners.add(listener);
    return () => {
      listeners!.delete(listener);
      if (!listeners!.size) this.cells.delete(key);
    };
  }
  private update(patch: Partial<SpreadsheetState>) {
    if (this.disposed) return;
    if (
      Object.entries(patch).every(
        ([key, value]) => this.state[key as keyof SpreadsheetState] === value,
      )
    )
      return;
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  private notify(keys: Iterable<string>) {
    for (const key of keys) this.cells.get(key)?.forEach((listener) => listener());
  }
  private blockId(address: Address) {
    return `${Math.floor(address.row / this.blockRows)}:${Math.floor(address.col / this.blockColumns)}`;
  }
  readCell = (address: Address): CellSnapshot =>
    this.blocks.get(this.blockId(address))?.cells.get(cellKey(address)) ?? EMPTY;
  private blockRange(id: string): CellRange {
    const [r, c] = id.split(':').map(Number);
    return {
      start: { row: r * this.blockRows, col: c * this.blockColumns },
      end: {
        row: Math.min(this.rows - 1, (r + 1) * this.blockRows - 1),
        col: Math.min(this.columns - 1, (c + 1) * this.blockColumns - 1),
      },
    };
  }
  private ids(range: CellRange) {
    const ids: string[] = [];
    const normalized = normalizeRange(range);
    for (
      let r = Math.floor(normalized.start.row / this.blockRows);
      r <= Math.floor(normalized.end.row / this.blockRows);
      r++
    ) {
      for (
        let c = Math.floor(normalized.start.col / this.blockColumns);
        c <= Math.floor(normalized.end.col / this.blockColumns);
        c++
      )
        ids.push(`${r}:${c}`);
    }
    return ids;
  }
  private async fetchBlock(id: string) {
    const current = this.blocks.get(id);
    if (current?.revision === this.state.revision) {
      this.blocks.delete(id);
      this.blocks.set(id, current);
      return;
    }
    const existing = this.flights.get(id);
    if (existing) return existing.promise;
    const controller = new AbortController();
    const generation = this.generation;
    const promise = Promise.resolve()
      .then(async () => {
        const result = await this.source.getBlock(this.blockRange(id), controller.signal);
        if (
          this.disposed ||
          controller.signal.aborted ||
          generation !== this.generation ||
          result.revision < this.state.revision
        )
          return;
        if (result.revision > this.state.revision) {
          this.invalidate(result.revision);
          return;
        }
        const cells = new Map<string, CellSnapshot>();
        const changed: string[] = [];
        for (const { row, col, ...cell } of result.cells) {
          const key = cellKey({ row, col });
          const previous = current?.cells.get(key);
          const same =
            previous &&
            previous.input === cell.input &&
            previous.value === cell.value &&
            previous.status === cell.status;
          cells.set(key, same ? previous : cell);
          if (!same) changed.push(key);
        }
        this.blocks.delete(id);
        this.blocks.set(id, { cells, revision: result.revision });
        this.notify(changed);
        while (this.blocks.size > this.maxBlocks) {
          const oldest = this.blocks.keys().next().value!;
          const removed = this.blocks.get(oldest)!;
          this.blocks.delete(oldest);
          this.notify(removed.cells.keys());
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted && !this.disposed) this.setError(error);
      })
      .finally(() => {
        if (this.flights.get(id)?.controller === controller) this.flights.delete(id);
        this.update({ loading: this.flights.size });
      });
    this.flights.set(id, { controller, promise });
    this.update({ loading: this.flights.size });
    return promise;
  }
  async ensureRange(range: CellRange) {
    this.assertAddress(range.start);
    this.assertAddress(range.end);
    const ids = this.ids(range);
    if (ids.length > this.maxBlocks)
      throw new Error('Requested range exceeds the client cache; use smaller batches');
    // A read can discover a newer source revision before its SSE event arrives.
    // In that case fetch again so callers can safely edit the loaded targets.
    for (let attempt = 0; attempt < 3; attempt++) {
      const revision = this.state.revision;
      await Promise.all(ids.map((id) => this.fetchBlock(id)));
      if (this.disposed || revision === this.state.revision) return;
    }
    throw new Error('The sheet changed while loading. Try again.');
  }
  setViewport(range: CellRange) {
    if (this.disposed) return;
    this.viewport = range;
    const wanted = new Set(this.ids(range));
    for (const [id, flight] of this.flights)
      if (!wanted.has(id)) {
        flight.controller.abort();
        this.flights.delete(id);
      }
    void this.ensureRange(range).catch((error) => this.setError(error));
  }
  private invalidate(revision: number, mappingChanged = false) {
    this.generation++;
    for (const flight of this.flights.values()) flight.controller.abort();
    this.flights.clear();
    if (mappingChanged) {
      const keys = [...this.blocks.values()].flatMap((block) => [...block.cells.keys()]);
      this.blocks.clear();
      this.notify(keys);
      const clamp = (address: Address) => ({
        row: Math.min(address.row, this.rows - 1),
        col: Math.min(address.col, this.columns - 1),
      });
      if (this.viewport)
        this.viewport = { start: clamp(this.viewport.start), end: clamp(this.viewport.end) };
      this.update({
        active: clamp(this.state.active),
        selection: {
          start: clamp(this.state.selection.start),
          end: clamp(this.state.selection.end),
        },
        viewRevision: this.view?.getSnapshot().revision ?? 0,
      });
    }
    for (const block of this.blocks.values()) {
      for (const [key, cell] of block.cells)
        block.cells.set(key, { ...cell, status: 'calculating' });
      this.notify(block.cells.keys());
    }
    this.update({ revision, loading: 0 });
    if (this.viewport) this.setViewport(this.viewport);
  }
  refresh() {
    this.invalidate(this.source.metadata.revision);
  }
  assertAddress(address: Address) {
    if (
      !Number.isInteger(address.row) ||
      !Number.isInteger(address.col) ||
      address.row < 0 ||
      address.col < 0 ||
      address.row >= this.rows ||
      address.col >= this.columns
    )
      throw new Error('Address is outside the sheet');
  }
  select(address: Address, extend = false) {
    this.assertAddress(address);
    this.update({
      selection: { start: extend ? this.state.selection.start : address, end: address },
      editing: null,
      draft: null,
      active: address,
      selectionKind: 'cells',
    });
  }
  selectAxis(axis: Axis, index: number, extend = false) {
    const coordinate = axis === 'rows' ? 'row' : 'col';
    const anchor =
      extend && this.state.selectionKind === axis ? this.state.selection.start[coordinate] : index;
    const start = axis === 'rows' ? { row: anchor, col: 0 } : { row: 0, col: anchor };
    const end =
      axis === 'rows' ? { row: index, col: this.columns - 1 } : { row: this.rows - 1, col: index };
    this.assertAddress(start);
    this.assertAddress(end);
    this.update({
      selection: { start, end },
      active: { ...this.state.active, [coordinate]: index },
      selectionKind: axis,
      editing: null,
      draft: null,
    });
  }
  selectAll() {
    this.update({
      selection: { start: { row: 0, col: 0 }, end: { row: this.rows - 1, col: this.columns - 1 } },
      selectionKind: 'all',
      editing: null,
      draft: null,
    });
  }
  beginEdit(address = this.state.active, initial?: string, editor: 'cell' | 'bar' = 'cell') {
    if (
      initial === undefined &&
      this.state.editing?.row === address.row &&
      this.state.editing.col === address.col
    ) {
      this.update({ editor });
      return;
    }
    if (!this.source.isEditable(address)) {
      this.setError(new Error('Source data is read-only. Edit a calculated column.'));
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
  private rebaseClipboard(before: SheetViewState, after: SheetViewState) {
    if (
      !this.clipboard?.positions ||
      (before.rows === after.rows && before.columns === after.columns)
    )
      return;
    const oldRows = new ViewAxis(before.rows);
    const oldColumns = new ViewAxis(before.columns);
    const rows = new ViewAxis(after.rows);
    const columns = new ViewAxis(after.columns);
    const positions = this.clipboard.positions.map((row) =>
      row.map((position) => ({
        row: rows.logicalIndex(oldRows.canonicalAtLogical(position.row)),
        col: columns.logicalIndex(oldColumns.canonicalAtLogical(position.col)),
      })),
    );
    if (positions.some((row) => row.some((position) => position.row < 0 || position.col < 0))) {
      this.clipboard = null;
      this.clipboardToken = '';
      return;
    }
    const inputs = this.clipboard.inputs.map((row) =>
      row.map((input) =>
        typeof input === 'string' && input.startsWith('=')
          ? mapViewFormula(mapViewFormula(input, before, 'bind'), after, 'display')
          : input,
      ),
    );
    this.clipboard = { ...this.clipboard, inputs, positions, origin: positions[0][0] };
  }
  private replaceView(next: SheetViewState) {
    if (!this.view) throw new Error('Configure viewState to change the view');
    const active = this.view.canonical(this.state.active);
    const before = this.view.getSnapshot();
    this.view.replace(next);
    this.rebaseClipboard(before, this.view.getSnapshot());
    const row = this.view.rows.visibleIndex(active.row);
    const col = this.view.columns.visibleIndex(active.col);
    this.select({
      row: row < 0 ? Math.min(this.state.active.row, this.rows - 1) : row,
      col: col < 0 ? Math.min(this.state.active.col, this.columns - 1) : col,
    });
  }
  setViewState(next: SheetViewState) {
    this.replaceView(next);
  }
  changeView(change: ViewChange) {
    if (!this.view) throw new Error('Configure viewState to change the view');
    if (this.state.editing || this.state.pending)
      throw new Error('Finish editing before changing the view');
    const beforeView = this.view.getSnapshot();
    const active = this.view.canonical(this.state.active);
    this.view.change(change);
    const afterView = this.view.getSnapshot();
    if (beforeView === afterView) return;
    this.rebaseClipboard(beforeView, afterView);
    const row = this.view.rows.visibleIndex(active.row);
    const col = this.view.columns.visibleIndex(active.col);
    this.select({
      row: row < 0 ? Math.min(this.state.active.row, this.rows - 1) : row,
      col: col < 0 ? Math.min(this.state.active.col, this.columns - 1) : col,
    });
    this.record({ beforeView, afterView });
  }
  setError(error: unknown) {
    this.update({ error: error instanceof Error ? error.message : String(error) });
  }
  clearError() {
    this.update({ error: null });
  }
  private async perform(mutation: Mutation) {
    if (this.disposed) throw new Error('Spreadsheet is disposed');
    if (this.state.pending) throw new Error('Wait for the current change to finish');
    if (this.state.connection === 'disconnected') throw new Error('Reconnect before editing');
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
  async edit(patches: CellPatch[]) {
    if (patches.length > 10000) throw new Error('Maximum edit size is 10,000 cells');
    const unique = [...new Map(patches.map((patch) => [cellKey(patch), patch])).values()];
    const beforeView = this.view?.getSnapshot();
    if (this.source.mode === 'remote' && !this.view) {
      const columns = new Map<number, string | null>();
      for (const patch of unique) {
        this.assertAddress(patch);
        if (!this.source.isEditable(patch)) throw new Error('This range contains read-only cells');
        if (
          patch.input !== null &&
          (typeof patch.input !== 'string' || !patch.input.startsWith('='))
        )
          throw new Error('Calculated columns require formulas starting with =');
        const formula =
          patch.input === null ? null : shiftFormula(patch.input as string, -patch.row, 0);
        if (columns.has(patch.col) && columns.get(patch.col) !== formula)
          throw new Error('Each server column must use one consistent formula template');
        columns.set(patch.col, formula);
      }
      const forward = { columns: [...columns].map(([col, formula]) => ({ col, formula })) };
      const backward = {
        columns: [...columns.keys()].map((col) => ({
          col,
          formula: this.source.getColumnFormula(col),
        })),
      };
      await this.perform(forward);
      this.record({ forward, backward });
      return;
    }
    const before: CellPatch[] = [];
    for (const patch of unique) {
      this.assertAddress(patch);
      if (!this.source.isEditable(patch)) throw new Error('This range contains read-only cells');
      const previous = this.readCell(patch);
      if (previous.status === 'loading' || previous.status === 'calculating')
        throw new Error('Load the target cells before editing');
      before.push({ row: patch.row, col: patch.col, input: previous.input });
    }
    const forward = { cells: unique };
    const backward = { cells: before };
    await this.perform(forward);
    this.record(
      beforeView ? { beforeView, afterView: this.view!.getSnapshot() } : { forward, backward },
    );
  }
  async setColumnFormula(col: number, formula: string | null) {
    const beforeView = this.view?.getSnapshot();
    this.assertAddress({ row: 0, col });
    if (!this.source.isEditable({ row: 0, col })) throw new Error('This column is read-only');
    const forward = { columns: [{ col, formula }] };
    const backward = { columns: [{ col, formula: this.source.getColumnFormula(col) }] };
    await this.perform(forward);
    this.record(
      beforeView ? { beforeView, afterView: this.view!.getSnapshot() } : { forward, backward },
    );
  }
  private record(entry: HistoryEntry) {
    if (this.disposed) return;
    this.undoStack.push(entry);
    if (this.undoStack.length > (this.options.historyLimit ?? 100)) this.undoStack.shift();
    this.redoStack = [];
    this.historyState();
  }
  private historyState() {
    this.update({ canUndo: !!this.undoStack.length, canRedo: !!this.redoStack.length });
  }
  async undo() {
    if (this.state.pending || this.state.editing) throw new Error('Finish editing before undo');
    const entry = this.undoStack.at(-1);
    if (!entry) return;
    if ('beforeView' in entry) this.replaceView(entry.beforeView);
    else await this.perform(entry.backward);
    this.undoStack.pop();
    this.redoStack.push(entry);
    this.historyState();
  }
  async redo() {
    if (this.state.pending || this.state.editing) throw new Error('Finish editing before redo');
    const entry = this.redoStack.at(-1);
    if (!entry) return;
    if ('afterView' in entry) this.replaceView(entry.afterView);
    else await this.perform(entry.forward);
    this.redoStack.pop();
    this.undoStack.push(entry);
    this.historyState();
  }
  copy() {
    this.clipboard = copyRange(this.state.selection, this.readCell, (address) =>
      this.logicalAddress(address),
    );
    this.clipboardToken = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}:${Math.random()}`;
    return this.clipboard.tsv;
  }
  getClipboardToken() {
    return this.clipboardToken;
  }
  async paste(text: string, useInternalFormulas = true) {
    const patches = pasteCells(
      text,
      normalizeRange(this.state.selection).start,
      useInternalFormulas ? this.clipboard : null,
      (address) => {
        this.assertAddress(address);
        return this.logicalAddress(address);
      },
    );
    if (!patches.length) return;
    for (const patch of patches) this.assertAddress(patch);
    if (this.source.mode === 'local' || this.view)
      await this.ensureRange({
        start: patches[0],
        end: {
          row: Math.max(...patches.map((p) => p.row)),
          col: Math.max(...patches.map((p) => p.col)),
        },
      });
    await this.edit(patches);
  }
  async clearSelection() {
    const range = normalizeRange(this.state.selection);
    const size = (range.end.row - range.start.row + 1) * (range.end.col - range.start.col + 1);
    if (this.source.mode === 'remote' && !this.view) {
      await this.edit(
        Array.from({ length: range.end.col - range.start.col + 1 }, (_, offset) => ({
          row: range.start.row,
          col: range.start.col + offset,
          input: null,
        })),
      );
      return;
    }
    if (size > 10000) throw new Error('Maximum edit size is 10,000 cells');
    await this.ensureRange(range);
    const patches: CellPatch[] = [];
    for (let row = range.start.row; row <= range.end.row; row++)
      for (let col = range.start.col; col <= range.end.col; col++)
        patches.push({ row, col, input: null });
    await this.edit(patches);
  }
  get cacheStats() {
    return {
      blocks: this.blocks.size,
      cells: [...this.blocks.values()].reduce((sum, block) => sum + block.cells.size, 0),
      inFlight: this.flights.size,
    };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    this.mutationController?.abort();
    for (const flight of this.flights.values()) flight.controller.abort();
    this.source.dispose();
    this.blocks.clear();
    this.flights.clear();
    this.cells.clear();
    this.listeners.clear();
    this.undoStack = [];
    this.redoStack = [];
    this.clipboard = null;
  }
}
