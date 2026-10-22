import {
  Address,
  createSpreadsheet,
  createViewState,
  EngineSession,
  FormulaEngine,
  ViewCalculationRegistry,
  type ViewCapableCalculator,
  type CellInput,
  type CellPatch,
  type EngineOptions,
  type SpreadsheetStore,
  type ViewSettings,
} from '@sheet/core';
import { createLocalSource } from '@sheet/transport';

/** A cell of example data, by zero-based row and column. */
export const cell = (row: number, col: number, input: CellInput): CellPatch => ({
  ...Address.of(row, col),
  input,
});

/** Runs calculations on the main thread; fine for small, complete in-memory datasets. */
function inProcessCalculator(session: EngineSession): ViewCapableCalculator {
  const registry = new ViewCalculationRegistry(session.engine);
  return {
    calculate: async (range) => session.block(range),
    apply: async (mutation, revision) => session.mutate(mutation, revision),
    views: {
      query: async (view) => registry.query(view, session.revision),
      summary: async (view, range) => registry.summary(view, range, session.revision),
      blocks: async (view, ranges) => registry.blocks(view, ranges, session.revision),
    },
    dispose() {},
  };
}

// Small, complete in-memory datasets. Use WorkerCalculationAdapter for large sheets.
export function createExampleStore(
  data: EngineOptions,
  settings: ViewSettings = {},
): SpreadsheetStore {
  const session = new EngineSession(new FormulaEngine(data));
  const source = createLocalSource({
    metadata: session.metadata,
    columnFormulas: data.columnFormulas,
    calculator: inProcessCalculator(session),
  });
  const state = {
    ...createViewState(source, { viewId: 'example', sourceId: 'example-data' }),
    ...settings,
  };
  return createSpreadsheet({ source, view: { state } });
}
