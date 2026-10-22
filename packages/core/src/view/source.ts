import { ColumnId, Revision, RowId } from '../brand';
import { isFormula, type CellInput, type CellRecord, type Formula } from '../cell';
import {
  Address,
  CellRange,
  cellKey,
  LogicalRow,
  sourceAddress,
  sourceCol,
  sourceRow,
  type CanonicalCol,
  type CellKey,
} from '../coords';
import { Emitter } from '../emitter';
import { abortError, SheetError } from '../errors';
import { hasQuery, validateCellInput } from '../features';
import { shiftFormula } from '../formula';
import type { DataBlock, Mutation, SourceEvent, ViewCapableSource, ViewedSource } from '../source';
import type { ViewController } from './controller';
import { bindInput, displayInput, mapViewFormula } from './formula';

const QUERY_RETRY_MS = 100;

/** Presents a source through a view. Edits are stored in the view document, never in the source. */
export function createViewSource(source: ViewCapableSource, view: ViewController): ViewedSource {
  if (
    view.getSnapshot().sourceRows !== source.metadata.rows ||
    view.getSnapshot().sourceColumns !== source.metadata.columns
  )
    throw new SheetError('INVALID_DOCUMENT', 'Saved view does not match this dataset');
  const views = source.views;
  let revision = source.metadata.revision;
  let sourceRevision = source.metadata.revision;
  const events = new Emitter<SourceEvent>();
  let disposed = false;
  const emit = (event: SourceEvent) => {
    if (!disposed) events.emit(event);
  };
  const bump = () => (revision = Revision.next(revision));
  let queryController: AbortController | undefined;
  let queryFlight: Promise<void> = Promise.resolve();
  let querying = false;
  let queryError: string | undefined;
  let queryAgain = false;
  let queryTimer: ReturnType<typeof setTimeout> | undefined;
  function refreshQuery() {
    clearTimeout(queryTimer);
    queryAgain = false;
    queryController?.abort();
    const controller = (queryController = new AbortController());
    queryError = undefined;
    if (!hasQuery(view.getSnapshot().query)) {
      view.setProjection();
      querying = false;
      queryFlight = Promise.resolve();
      emit({ type: 'query', revision: bump(), mappingChanged: true, querying: false });
      return;
    }
    querying = true;
    emit({ type: 'query', revision: bump(), querying: true });
    queryFlight = Promise.resolve()
      .then(async () => {
        const result = await views.query(view.getSnapshot(), controller.signal);
        if (disposed || controller.signal.aborted) return;
        sourceRevision = Revision.unsafe(Math.max(sourceRevision, result.revision));
        view.setProjection(result.rows);
        querying = false;
        emit({ type: 'query', revision: bump(), mappingChanged: true, querying: false });
      })
      .catch((error: unknown) => {
        if (!disposed && !controller.signal.aborted) {
          querying = false;
          queryError = String(error);
          view.setProjection(new Uint32Array());
          emit({
            type: 'query',
            revision: bump(),
            mappingChanged: true,
            querying: false,
            error: queryError,
          });
        }
      })
      .finally(() => {
        if (!disposed && !controller.signal.aborted && queryAgain) {
          queryAgain = false;
          queryTimer = setTimeout(refreshQuery, QUERY_RETRY_MS);
        }
      });
  }
  const unsubscribeSource = source.subscribe((event) => {
    if (event.revision > sourceRevision) {
      sourceRevision = event.revision;
      bump();
      if (hasQuery(view.getSnapshot().query)) {
        if (querying) queryAgain = true;
        else refreshQuery();
      }
    }
    emit({ ...event, revision });
  });
  const unsubscribeView = view.subscribe(refreshQuery);
  if (hasQuery(view.getSnapshot().query)) refreshQuery();
  function editable(address: Address) {
    if (
      querying ||
      address.row < 0 ||
      address.row >= view.rows.count ||
      address.col < 0 ||
      address.col >= view.columns.count
    )
      return false;
    const canonical = view.canonical(address);
    const state = view.getSnapshot();
    return (
      !!state.rows.owned[canonical.row] ||
      !!state.columns.owned[canonical.col] ||
      (source.mode === 'local' && source.isEditable(sourceAddress(canonical)))
    );
  }
  async function settled() {
    await queryFlight;
    if (queryError) throw new Error(queryError);
  }
  return {
    mode: source.mode,
    view,
    get metadata() {
      return { rows: view.rows.count, columns: view.columns.count, revision };
    },
    rowId(index) {
      const id = view.rows.canonicalAt(index);
      const owned = view.getSnapshot().rows.owned[id];
      return owned ? RowId.unsafe(owned.id) : source.rowId(sourceRow(id));
    },
    columnId(index) {
      const id = view.columns.canonicalAt(index);
      const owned = view.getSnapshot().columns.owned[id];
      return owned ? ColumnId.unsafe(owned.id) : source.columnId(sourceCol(id));
    },
    isEditable: editable,
    async summary(range, signal) {
      await settled();
      return views.summary(view.getSnapshot(), range, signal);
    },
    async getBlock(range, signal): Promise<DataBlock> {
      await settled();
      if (signal.aborted) throw abortError();
      const state = view.getSnapshot();
      const requestedRevision = revision;
      const rows = view.rows;
      const columns = view.columns;
      const rr = rows.slice(range.start.row, CellRange.rows(range));
      const cc = columns.slice(range.start.col, CellRange.columns(range));
      const ranges = rr.flatMap((r) =>
        cc.map((c) =>
          CellRange.unsafe<'canonical'>(
            r.start,
            c.start,
            r.start + r.count - 1,
            c.start + c.count - 1,
          ),
        ),
      );
      const result = await views.blocks(state, ranges, signal);
      if (result.revision > sourceRevision) {
        sourceRevision = result.revision;
        emit({ type: 'revision', revision: bump() });
      }
      const cells: CellRecord[] = [];
      for (const block of result.blocks)
        for (const cell of block.cells) {
          const address = view.visible(cell);
          if (!address) continue;
          cells.push({ ...cell, ...address, input: displayInput(cell.input, state) });
        }
      return { range, revision: requestedRevision, cells };
    },
    async mutate(mutation: Mutation, expected, signal) {
      if (signal.aborted) throw abortError();
      if (expected !== revision)
        throw new SheetError('REVISION_CONFLICT', 'Revision conflict. Refresh and try again.');
      const current = view.getSnapshot();
      const cells: Record<CellKey, CellInput> = { ...current.cells };
      const columnFormulas = { ...current.columnFormulas };
      const changedColumns = new Map<CanonicalCol, Formula | null>();
      const firstRow = view.rows.canonicalAtLogical(LogicalRow.unsafe(0));
      switch (mutation.kind) {
        case 'cells':
          for (const patch of mutation.cells) {
            if (!editable(patch)) throw new SheetError('READ_ONLY', 'Source data is read-only');
            const canonical = view.canonical(patch);
            const input = bindInput(patch.input, current);
            if (
              source.mode === 'remote' &&
              current.columns.owned[canonical.col] &&
              !current.rows.owned[canonical.row]
            ) {
              if (input !== null && !isFormula(input))
                throw new SheetError(
                  'INVALID_INPUT',
                  'Calculated columns require a formula starting with =',
                );
              const template = input === null ? null : shiftFormula(input, -canonical.row, 0);
              const previous = changedColumns.get(canonical.col);
              if (previous !== undefined && previous !== template)
                throw new SheetError(
                  'INVALID_INPUT',
                  'Each column must use one consistent formula template',
                );
              changedColumns.set(canonical.col, template);
            } else {
              validateCellInput(patch.input, current.columnOptions?.[canonical.col]);
              cells[cellKey(canonical)] = input;
            }
          }
          break;
        case 'columns':
          for (const patch of mutation.columns) {
            if (!editable(Address.unsafe(0, patch.col)))
              throw new SheetError('READ_ONLY', 'Source column is read-only');
            const col = view.columns.canonicalAt(patch.col);
            if (source.mode === 'remote' && !current.columns.owned[col])
              throw new SheetError('READ_ONLY', 'Source column is read-only');
            changedColumns.set(
              col,
              patch.formula === null
                ? null
                : shiftFormula(mapViewFormula(patch.formula, current, 'bind'), -firstRow, 0),
            );
          }
          break;
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
            shiftFormula(formula, view.rows.canonicalAtLogical(LogicalRow.unsafe(0)), 0),
            state,
            'display',
          )
        : null;
    },
    subscribe(listener) {
      const unsubscribe = events.subscribe(listener);
      listener({ type: 'query', revision, querying });
      return unsubscribe;
    },
    dispose() {
      disposed = true;
      queryController?.abort();
      clearTimeout(queryTimer);
      unsubscribeSource();
      unsubscribeView();
      events.clear();
      source.dispose();
    },
  };
}
