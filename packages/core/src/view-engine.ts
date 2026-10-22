import { FormulaEngine } from './engine';
import { addressFromKey, type CellRange, type DataBlock } from './types';
import { ViewAxis, validateViewState, type SheetViewState } from './view';

/** Each view has an isolated overlay over a complete source. No source mutations. */
export class ViewCalculationRegistry {
  private views = new Map<string, { signature: string; engine: FormulaEngine; revision: number }>();
  constructor(
    private source: FormulaEngine,
    private maxViews = 8,
  ) {}
  blocks(
    view: SheetViewState,
    ranges: CellRange[],
    revision: number,
  ): { blocks: DataBlock[]; revision: number } {
    validateViewState(view);
    if (view.sourceRows !== this.source.rows || view.sourceColumns !== this.source.columns)
      throw new Error('View dimensions do not match the source');
    if (
      ranges.length > 1024 ||
      ranges.reduce(
        (sum, range) =>
          sum + (range.end.row - range.start.row + 1) * (range.end.col - range.start.col + 1),
        0,
      ) > 20000
    )
      throw new Error('View request exceeds 20,000 cells');
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
      entry.engine.clearCache();
      entry.revision = revision;
    }
    this.views.delete(view.viewId);
    this.views.set(view.viewId, entry);
    while (this.views.size > this.maxViews) this.views.delete(this.views.keys().next().value!);
    return { blocks: ranges.map((range) => entry!.engine.block(range, revision)), revision };
  }
}
