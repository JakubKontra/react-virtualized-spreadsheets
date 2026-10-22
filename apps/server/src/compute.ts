import { parentPort, workerData } from 'node:worker_threads';
import {
  Address,
  ColIndex,
  EngineSession,
  isError,
  isRecord,
  LIMITS,
  parseFormula,
  SheetError,
  ViewCalculationRegistry,
  type Formula,
} from '@sheet/core';
import { createCalculationHandlers, serveRpc, type RemoteMetadata } from '@sheet/transport';
import { createSalesEngine } from '../../shared/sales';
import { portScope } from './node-rpc';
import type { ServerEvents, ServerProtocol, WorkerOptions } from './protocol';

/** Source columns are read-only; these calculated columns can be edited. */
const EDITABLE = Array.from({ length: 44 }, (_, i) => ColIndex.unsafe(i + 6));

function parseWorkerData(data: unknown): WorkerOptions {
  const rows = isRecord(data) ? data['rows'] : undefined;
  const tickMs = isRecord(data) ? data['tickMs'] : undefined;
  if (typeof rows !== 'number' || typeof tickMs !== 'number')
    throw new Error('Invalid worker options');
  return { rows, tickMs };
}

if (!parentPort) throw new Error('compute.ts must run in a worker thread');
const options = parseWorkerData(workerData);
const engine = createSalesEngine(options.rows);
const session = new EngineSession(engine, ({ col }) => col >= 6, true);
const views = new ViewCalculationRegistry(engine);
const metadata = (): RemoteMetadata => {
  const columnFormulas: Partial<Record<number, Formula>> = {};
  for (const col of EDITABLE) {
    const formula = engine.columnFormula(col);
    if (formula !== null) columnFormulas[col] = formula;
  }
  return { ...session.metadata, columnFormulas, editableColumns: EDITABLE };
};

const server = serveRpc<ServerProtocol, ServerEvents>(portScope(parentPort), {
  ...createCalculationHandlers(session, views),
  meta: () => metadata(),
  mutate({ mutation, revision }) {
    if (mutation.kind !== 'columns' || mutation.columns.length > EDITABLE.length)
      throw new SheetError('INVALID_INPUT', 'Expected calculated column definitions');
    for (const column of mutation.columns) {
      if (column.formula === null) continue;
      if (column.formula.length > LIMITS.maxFormulaLength)
        throw new SheetError('INVALID_INPUT', 'Invalid formula');
      const parsed = parseFormula(column.formula);
      if (parsed.type === 'literal' && isError(parsed.value))
        throw new SheetError('INVALID_INPUT', parsed.value.message);
    }
    session.mutate(mutation, revision);
    const result = metadata();
    server.emit('metadata', result);
    return result;
  },
  tick() {
    tick();
    return metadata();
  },
});

let ticks = 0;
function tick() {
  // A deterministic upstream update, independent of the user's undo history.
  ticks++;
  const row = (ticks - 1) % Math.min(options.rows, 20);
  engine.apply({ kind: 'cells', cells: [{ ...Address.unsafe(row, 3), input: (ticks % 9) + 2 }] });
  session.touch();
  server.emit('metadata', metadata());
}
if (options.tickMs > 0) setInterval(tick, options.tickMs);
