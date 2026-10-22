import {
  createSpreadsheet,
  createViewState,
  EngineSession,
  FormulaEngine,
  ViewCalculationRegistry,
  type EngineOptions,
  type ViewSettings,
} from '@sheet/core';
import { createLocalSource } from '@sheet/transport';

// Small, complete in-memory datasets. Use WorkerCalculationAdapter for large sheets.
export function createExampleStore(data: EngineOptions, settings: ViewSettings = {}) {
  const engine = new FormulaEngine(data);
  const session = new EngineSession(engine);
  const registry = new ViewCalculationRegistry(engine);
  const source = createLocalSource({
    metadata: session.metadata,
    columnFormulas: data.columnFormulas,
    calculator: {
      async calculate(range) {
        return session.block(range);
      },
      async calculateView(view, ranges) {
        return registry.blocks(view, ranges, session.revision);
      },
      async queryView(view) {
        return registry.query(view, session.revision);
      },
      async summarizeView(view, range) {
        return registry.summary(view, range, session.revision);
      },
      async apply(mutation, revision) {
        return session.mutate(mutation, revision);
      },
      dispose() {},
    },
  });
  const viewState = {
    ...createViewState(source, { viewId: 'example', sourceId: 'example-data' }),
    ...settings,
  };
  return createSpreadsheet({ source, viewState });
}
