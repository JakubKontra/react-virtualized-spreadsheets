import { FormulaEngine } from './engine';
import {
  addressFromKey,
  isError,
  normalizeRange,
  type CellValue,
  type CellRange,
  type DataBlock,
} from './types';
import { matchesFilter, type SelectionSummary, type ViewRows } from './features';
import { ViewAxis, validateViewState, type SheetViewState } from './view';

/** Each view has an isolated overlay over a complete source. No source mutations. */
export class ViewCalculationRegistry {
  private views = new Map<
    string,
    {
      signature: string;
      engine: FormulaEngine;
      revision: number;
      queryKey?: string;
      queryRows?: Uint32Array;
    }
  >();
  constructor(
    private source: FormulaEngine,
    private maxViews = 8,
  ) {}
  private entry(view: SheetViewState, revision: number) {
    validateViewState(view);
    if (view.sourceRows !== this.source.rows || view.sourceColumns !== this.source.columns)
      throw new Error('View dimensions do not match the source');
    const signature = JSON.stringify([
      view.cells,
      view.columnFormulas,
      view.rows.nextIndex,
      view.columns.nextIndex,
      [...view.rows.order].sort((a, b) => a.start - b.start),
      [...view.columns.order].sort((a, b) => a.start - b.start),
      view.columns.owned,
    ]);
    let entry = this.views.get(view.viewId);
    if (!entry || entry.signature !== signature) {
      const rows = new ViewAxis(view.rows);
      const columns = new ViewAxis(view.columns);
      const engine = new FormulaEngine({
        rows: view.rows.nextIndex,
        columns: view.columns.nextIndex,
        cells: Object.entries(view.cells).map(([key, input]) => ({
          ...addressFromKey(key),
          input,
        })),
        columnFormulas: Object.fromEntries(
          Object.entries(view.columnFormulas).filter(([, value]) => value !== null),
        ) as Record<number, string>,
        isPresent: ({ row, col }) => rows.has(row) && columns.has(col),
        readInput: (address) =>
          address.row >= this.source.rows ||
          address.col >= this.source.columns ||
          view.columns.owned[address.col]
            ? null
            : this.source.input(address),
      });
      entry = { signature, engine, revision };
    } else if (entry.revision !== revision) {
      entry.queryKey = undefined;
      entry.engine.clearCache();
      entry.revision = revision;
    }
    this.views.delete(view.viewId);
    this.views.set(view.viewId, entry);
    while (this.views.size > this.maxViews) this.views.delete(this.views.keys().next().value!);
    return entry;
  }
  blocks(
    view: SheetViewState,
    ranges: CellRange[],
    revision: number,
  ): { blocks: DataBlock[]; revision: number } {
    if (
      ranges.length > 1024 ||
      ranges.some((r) => r.start.row > r.end.row || r.start.col > r.end.col) ||
      ranges.reduce(
        (sum, r) => sum + (r.end.row - r.start.row + 1) * (r.end.col - r.start.col + 1),
        0,
      ) > 20000
    )
      throw new Error('View request exceeds 20,000 cells');
    const entry = this.entry(view, revision);
    return { blocks: ranges.map((range) => entry.engine.block(range, revision)), revision };
  }
  query(view: SheetViewState, revision: number): ViewRows {
    const entry = this.entry(view, revision);
    const key = JSON.stringify([
      view.query,
      view.rows.order,
      view.rows.hidden,
      view.columns.order,
      view.columns.hidden,
    ]);
    if (entry.queryKey === key && entry.queryRows) return { rows: entry.queryRows, revision };
    const axis = new ViewAxis(view.rows),
      columns = new ViewAxis(view.columns);
    const query = view.query ?? {};
    const search = query.search?.trim().toLocaleLowerCase();
    const rows = new Uint32Array(axis.count);
    let count = 0;
    for (const span of axis.visible)
      for (let row = span.start; row < span.start + span.count; row++) {
        if (query.filters?.some((f) => !matchesFilter(entry.engine.value({ row, col: f.col }), f)))
          continue;
        if (search) {
          let match = false;
          for (const span of columns.visible) {
            for (let col = span.start; col < span.start + span.count; col++) {
              const value = entry.engine.value({ row, col });
              if (
                !isError(value) &&
                value !== null &&
                String(value).toLocaleLowerCase().includes(search)
              ) {
                match = true;
                break;
              }
            }
            if (match) break;
          }
          if (!match) continue;
        }
        rows[count++] = row;
      }
    const result = rows.slice(0, count);
    if (query.sorts?.length) {
      const keys = query.sorts.map((s) => {
        const values: CellValue[] = new Array(view.rows.nextIndex);
        for (const row of result) values[row] = entry.engine.value({ row, col: s.col });
        return values;
      });
      result.sort((a, b) => {
        for (let i = 0; i < query.sorts!.length; i++) {
          const left = keys[i][a],
            right = keys[i][b];
          const emptyLeft = left === null || left === '' || isError(left),
            emptyRight = right === null || right === '' || isError(right);
          if (emptyLeft !== emptyRight) return emptyLeft ? 1 : -1;
          if (emptyLeft) continue;
          const compared =
            typeof left === 'number' && typeof right === 'number'
              ? left - right
              : String(left).localeCompare(String(right));
          if (compared) return compared * (query.sorts![i].direction === 'asc' ? 1 : -1);
        }
        return 0;
      });
    }
    entry.queryKey = key;
    entry.queryRows = result;
    return { rows: result, revision };
  }
  summary(view: SheetViewState, selection: CellRange, revision: number): SelectionSummary {
    const entry = this.entry(view, revision),
      rows = this.query(view, revision).rows,
      cols = new ViewAxis(view.columns);
    const range = normalizeRange(selection);
    if (
      ![range.start.row, range.end.row, range.start.col, range.end.col].every(
        Number.isSafeInteger,
      ) ||
      range.start.row < 0 ||
      range.start.col < 0 ||
      range.end.row >= rows.length ||
      range.end.col >= cols.count
    )
      throw new Error('Invalid summary range');
    const result: SelectionSummary = {
      count: 0,
      numericCount: 0,
      sum: 0,
      average: null,
      min: null,
      max: null,
      revision,
    };
    for (let r = range.start.row; r <= range.end.row; r++)
      for (let c = range.start.col; c <= range.end.col; c++) {
        const value = entry.engine.value({ row: rows[r], col: cols.canonicalAt(c) });
        if (value !== null && value !== '') result.count++;
        if (typeof value === 'number') {
          result.numericCount++;
          result.sum += value;
          result.min = result.min === null ? value : Math.min(result.min, value);
          result.max = result.max === null ? value : Math.max(result.max, value);
        }
      }
    result.average = result.numericCount ? result.sum / result.numericCount : null;
    return result;
  }
}
