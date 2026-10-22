import { firstKey } from '../assert';
import type { Revision } from '../brand';
import { isError, type CellPatch, type CellValue, type Formula } from '../cell';
import {
  Address,
  CanonicalRow,
  CellRange,
  ColIndex,
  parseCellKey,
  sourceAddress,
  type CanonicalAddress,
} from '../coords';
import { FormulaEngine } from '../engine';
import { SheetError } from '../errors';
import { matchesFilter } from '../features';
import { LIMITS } from '../limits';
import type { SelectionSummary, ViewBlocks, ViewRows } from '../source';
import { ViewAxis } from './axis';
import { validateViewState } from './parse';
import type { SheetViewState } from './state';

interface Entry {
  signature: string;
  engine: FormulaEngine<'canonical'>;
  revision: Revision;
  queryKey?: string | undefined;
  queryRows?: Uint32Array | undefined;
}

const isBlank = (value: CellValue | undefined) =>
  value === undefined || value === null || value === '' || isError(value);

/** Each view has an isolated overlay over a complete source. No source mutations. */
export class ViewCalculationRegistry {
  private views = new Map<string, Entry>();
  constructor(
    private source: FormulaEngine,
    private maxViews = 8,
  ) {}
  private entry(view: SheetViewState, revision: Revision): Entry {
    validateViewState(view);
    if (view.sourceRows !== this.source.rows || view.sourceColumns !== this.source.columns)
      throw new SheetError('INVALID_DOCUMENT', 'View dimensions do not match the source');
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
      const cells: CellPatch<'canonical'>[] = [];
      for (const [key, input] of Object.entries(view.cells)) {
        const address = parseCellKey<'canonical'>(key);
        if (address && input !== undefined) cells.push({ ...address, input });
      }
      const columnFormulas: Partial<Record<number, Formula>> = {};
      for (const [col, formula] of Object.entries(view.columnFormulas))
        if (formula) columnFormulas[Number(col)] = formula;
      const engine = new FormulaEngine<'canonical'>({
        rows: view.rows.nextIndex,
        columns: view.columns.nextIndex,
        cells,
        columnFormulas,
        isPresent: ({ row, col }) => rows.has(row) && columns.has(col),
        readInput: (address) =>
          address.row >= this.source.rows ||
          address.col >= this.source.columns ||
          view.columns.owned[address.col]
            ? null
            : this.source.input(sourceAddress(address)),
      });
      entry = { signature, engine, revision };
    } else if (entry.revision !== revision) {
      entry.queryKey = undefined;
      entry.engine.clearCache();
      entry.revision = revision;
    }
    this.views.delete(view.viewId);
    this.views.set(view.viewId, entry);
    while (this.views.size > this.maxViews) {
      const oldest = firstKey(this.views);
      if (oldest === undefined) break;
      this.views.delete(oldest);
    }
    return entry;
  }
  blocks(
    view: SheetViewState,
    ranges: readonly CellRange<'canonical'>[],
    revision: Revision,
  ): ViewBlocks {
    if (
      ranges.length > LIMITS.maxViewRanges ||
      ranges.some((r) => r.start.row > r.end.row || r.start.col > r.end.col) ||
      ranges.reduce((sum, r) => sum + CellRange.size(r), 0) > LIMITS.maxBlockCells
    )
      throw new SheetError('LIMIT_EXCEEDED', 'View request exceeds 20,000 cells');
    const entry = this.entry(view, revision);
    return { blocks: ranges.map((range) => entry.engine.block(range, revision)), revision };
  }
  query(view: SheetViewState, revision: Revision): ViewRows {
    const entry = this.entry(view, revision);
    const key = JSON.stringify([
      view.query,
      view.rows.order,
      view.rows.hidden,
      view.columns.order,
      view.columns.hidden,
    ]);
    if (entry.queryKey === key && entry.queryRows) return { rows: entry.queryRows, revision };
    const axis = new ViewAxis(view.rows);
    const columns = new ViewAxis(view.columns);
    const value = (row: number, col: number) =>
      entry.engine.value(Address.unsafe<'canonical'>(row, col));
    const { filters = [], sorts = [], search: rawSearch } = view.query ?? {};
    const search = rawSearch?.trim().toLocaleLowerCase();
    const rows = new Uint32Array(axis.count);
    let count = 0;
    for (const span of axis.visible)
      for (let row = span.start; row < span.start + span.count; row++) {
        if (filters.some((f) => !matchesFilter(value(row, f.col), f))) continue;
        if (search) {
          let match = false;
          search: for (const columnSpan of columns.visible)
            for (let col = columnSpan.start; col < columnSpan.start + columnSpan.count; col++) {
              const cell = value(row, col);
              if (
                !isError(cell) &&
                cell !== null &&
                String(cell).toLocaleLowerCase().includes(search)
              ) {
                match = true;
                break search;
              }
            }
          if (!match) continue;
        }
        rows[count++] = row;
      }
    const result = rows.slice(0, count);
    if (sorts.length) {
      const keys = sorts.map((sort) => {
        const values: CellValue[] = new Array(view.rows.nextIndex);
        for (const row of result) values[row] = value(row, sort.col);
        return { values, sign: sort.direction === 'asc' ? 1 : -1 };
      });
      result.sort((a, b) => {
        for (const { values, sign } of keys) {
          const left = values[a];
          const right = values[b];
          const emptyLeft = isBlank(left);
          const emptyRight = isBlank(right);
          if (emptyLeft !== emptyRight) return emptyLeft ? 1 : -1;
          if (emptyLeft) continue;
          const compared =
            typeof left === 'number' && typeof right === 'number'
              ? left - right
              : String(left).localeCompare(String(right));
          if (compared) return compared * sign;
        }
        return 0;
      });
    }
    entry.queryKey = key;
    entry.queryRows = result;
    return { rows: result, revision };
  }
  summary(view: SheetViewState, selection: CellRange, revision: Revision): SelectionSummary {
    const entry = this.entry(view, revision);
    const rows = this.query(view, revision).rows;
    const cols = new ViewAxis(view.columns);
    const range = CellRange.normalize(selection);
    if (
      ![range.start.row, range.end.row, range.start.col, range.end.col].every(
        Number.isSafeInteger,
      ) ||
      range.start.row < 0 ||
      range.start.col < 0 ||
      range.end.row >= rows.length ||
      range.end.col >= cols.count
    )
      throw new SheetError('OUT_OF_BOUNDS', 'Invalid summary range');
    let count = 0;
    let numericCount = 0;
    let sum = 0;
    let min: number | null = null;
    let max: number | null = null;
    for (let r = range.start.row; r <= range.end.row; r++) {
      const row = CanonicalRow.unsafe(rows[r] ?? 0);
      for (let c = range.start.col; c <= range.end.col; c++) {
        const address: CanonicalAddress = { row, col: cols.canonicalAt(ColIndex.unsafe(c)) };
        const value = entry.engine.value(address);
        if (value !== null && value !== '') count++;
        if (typeof value === 'number') {
          numericCount++;
          sum += value;
          min = min === null ? value : Math.min(min, value);
          max = max === null ? value : Math.max(max, value);
        }
      }
    }
    return {
      count,
      numericCount,
      sum,
      average: numericCount ? sum / numericCount : null,
      min,
      max,
      revision,
    };
  }
}
