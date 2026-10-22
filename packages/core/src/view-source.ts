import { shiftFormula } from './formula';
import { mapViewFormula } from './view-formula';
import {
  cellKey,
  type Address,
  type CellInput,
  type CellRange,
  type DataSource,
  type SourceEvent,
} from './types';
import { ViewController } from './view';

export function createViewSource(source: DataSource, view: ViewController): DataSource {
  if (!source.getViewBlocks)
    throw new Error('The data source must implement getViewBlocks to calculate a view');
  if (
    view.getSnapshot().sourceRows !== source.metadata.rows ||
    view.getSnapshot().sourceColumns !== source.metadata.columns
  )
    throw new Error('Saved view does not match this dataset');
  let revision = source.metadata.revision;
  let sourceRevision = source.metadata.revision;
  const listeners = new Set<(event: SourceEvent) => void>();
  let disposed = false;
  const emit = (event: SourceEvent) => {
    if (!disposed) listeners.forEach((listener) => listener(event));
  };
  const unsubscribeSource = source.subscribe((event) => {
    if (event.revision > sourceRevision) {
      sourceRevision = event.revision;
      revision++;
    }
    emit({ ...event, revision });
  });
  const unsubscribeView = view.subscribe(() => {
    revision++;
    emit({ revision, mappingChanged: true });
  });
  function editable(address: Address) {
    const canonical = view.canonical(address);
    const state = view.getSnapshot();
    return (
      !!state.rows.owned[canonical.row] ||
      !!state.columns.owned[canonical.col] ||
      (source.mode === 'local' && source.isEditable(canonical))
    );
  }
  function bind(input: CellInput) {
    return typeof input === 'string' && input.startsWith('=')
      ? mapViewFormula(input, view.getSnapshot(), 'bind')
      : input;
  }
  return {
    mode: source.mode,
    view,
    get metadata() {
      return { rows: view.rows.count, columns: view.columns.count, revision };
    },
    rowId(index) {
      const id = view.rows.canonicalAt(index);
      return view.getSnapshot().rows.owned[id]?.id ?? source.rowId(id);
    },
    columnId(index) {
      const id = view.columns.canonicalAt(index);
      return view.getSnapshot().columns.owned[id]?.id ?? source.columnId(id);
    },
    isEditable: editable,
    async getBlock(range, signal) {
      const state = view.getSnapshot();
      const requestedRevision = revision;
      const rows = view.rows;
      const columns = view.columns;
      const rr = rows.slice(range.start.row, range.end.row - range.start.row + 1);
      const cc = columns.slice(range.start.col, range.end.col - range.start.col + 1);
      const ranges: CellRange[] = rr.flatMap((r) =>
        cc.map((c) => ({
          start: { row: r.start, col: c.start },
          end: { row: r.start + r.count - 1, col: c.start + c.count - 1 },
        })),
      );
      const result = await source.getViewBlocks!(state, ranges, signal);
      if (result.revision > sourceRevision) {
        sourceRevision = result.revision;
        revision++;
        emit({ revision });
      }
      return {
        range,
        revision: requestedRevision,
        cells: result.blocks.flatMap((block) =>
          block.cells.map((cell) => ({
            ...cell,
            row: rows.visibleIndex(cell.row),
            col: columns.visibleIndex(cell.col),
            input:
              typeof cell.input === 'string' && cell.input.startsWith('=')
                ? mapViewFormula(cell.input, state, 'display')
                : cell.input,
          })),
        ),
      };
    },
    async mutate(mutation, expected, signal) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      if (expected !== revision) throw new Error('Revision conflict. Refresh and try again.');
      const current = view.getSnapshot();
      const cells = { ...current.cells };
      const columnFormulas = { ...current.columnFormulas };
      const changedColumns = new Map<number, string | null>();
      for (const patch of mutation.cells ?? []) {
        if (!editable(patch)) throw new Error('Source data is read-only');
        const canonical = view.canonical(patch);
        const input = bind(patch.input);
        if (
          source.mode === 'remote' &&
          current.columns.owned[canonical.col] &&
          !current.rows.owned[canonical.row]
        ) {
          if (input !== null && (typeof input !== 'string' || !input.startsWith('=')))
            throw new Error('Calculated columns require a formula starting with =');
          const template = input === null ? null : shiftFormula(input as string, -canonical.row, 0);
          if (changedColumns.has(canonical.col) && changedColumns.get(canonical.col) !== template)
            throw new Error('Each column must use one consistent formula template');
          changedColumns.set(canonical.col, template);
        } else cells[cellKey(canonical)] = input;
      }
      for (const patch of mutation.columns ?? []) {
        if (!editable({ row: 0, col: patch.col })) throw new Error('Source column is read-only');
        const col = view.columns.canonicalAt(patch.col);
        if (source.mode === 'remote' && !current.columns.owned[col])
          throw new Error('Source column is read-only');
        const row = view.rows.canonicalAtLogical(0);
        changedColumns.set(
          col,
          patch.formula === null ? null : shiftFormula(bind(patch.formula) as string, -row, 0),
        );
      }
      for (const [col, formula] of changedColumns) columnFormulas[col] = formula;
      view.replace({ ...current, cells, columnFormulas });
      return { revision };
    },
    getColumnFormula(index) {
      const state = view.getSnapshot();
      const formula = state.columnFormulas[view.columns.canonicalAt(index)];
      return formula
        ? mapViewFormula(
            shiftFormula(formula, view.rows.canonicalAtLogical(0), 0),
            state,
            'display',
          )
        : null;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      disposed = true;
      unsubscribeSource();
      unsubscribeView();
      listeners.clear();
      source.dispose();
    },
  };
}
