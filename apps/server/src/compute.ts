import { parentPort, workerData } from 'node:worker_threads';
import { EngineSession, parseFormula, isError, type CellRange, type Mutation } from '@sheet/core';
import { createSalesEngine } from '../../shared/sales';

const rows: number = workerData.rows;
const engine = createSalesEngine(rows);
const session = new EngineSession(engine, ({ col }) => col >= 6, true);
const metadata = () => ({
  ...session.metadata,
  columnFormulas: Object.fromEntries(
    Array.from({ length: 44 }, (_, i) => i + 6)
      .map((col) => [col, engine.columnFormula(col)])
      .filter(([, formula]) => formula !== null),
  ),
  editableColumns: Array.from({ length: 44 }, (_, i) => i + 6),
});
parentPort!.on('message', ({ id, method, payload }) => {
  try {
    let result: unknown;
    if (method === 'meta') result = metadata();
    else if (method === 'block') result = session.block(payload as CellRange);
    else if (method === 'mutate') {
      const data = payload as { mutation: Mutation; revision: number };
      if (
        !data ||
        !Number.isInteger(data.revision) ||
        !data.mutation ||
        !Array.isArray(data.mutation.columns) ||
        data.mutation.columns.length > 44 ||
        data.mutation.cells?.length
      )
        throw new Error('Expected calculated column definitions');
      for (const column of data.mutation.columns) {
        if (
          column.formula !== null &&
          (typeof column.formula !== 'string' || column.formula.length > 8192)
        )
          throw new Error('Invalid formula');
        if (column.formula !== null) {
          const parsed = parseFormula(column.formula);
          if (parsed.type === 'literal' && isError(parsed.value))
            throw new Error(parsed.value.message);
        }
      }
      session.mutate(data.mutation, data.revision);
      result = metadata();
      parentPort!.postMessage({ event: result });
    } else if (method === 'tick') {
      tick();
      result = metadata();
    } else throw new Error('Unknown method');
    parentPort!.postMessage({ id, result });
  } catch (error) {
    parentPort!.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
});
let ticks = 0;
function tick() {
  // A deterministic upstream update, independent of the user's undo history.
  ticks++;
  const row = (ticks - 1) % Math.min(rows, 20);
  engine.apply({ cells: [{ row, col: 3, input: (ticks % 9) + 2 }] });
  session.revision++;
  parentPort!.postMessage({ event: metadata() });
}
if (workerData.tickMs > 0) setInterval(tick, workerData.tickMs);
