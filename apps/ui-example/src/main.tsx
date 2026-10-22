import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  createSpreadsheet,
  createViewState,
  EngineSession,
  FormulaEngine,
  ViewCalculationRegistry,
} from '@sheet/core';
import { createLocalSource } from '@sheet/transport';
import { Spreadsheet, Button } from '@sheet/ui';
import './style.css';

function createInventory(view: boolean) {
  const engine = new FormulaEngine({
    rows: 300,
    columns: 8,
    readInput: ({ row, col }) =>
      col === 0
        ? `Part ${row + 1}`
        : col === 1
          ? 12.5 + row
          : col === 2
            ? 'Available'
            : col === 3
              ? `=B${row + 1}*2`
              : null,
  });
  const session = new EngineSession(engine),
    registry = new ViewCalculationRegistry(engine);
  const source = createLocalSource({
    metadata: session.metadata,
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
  const viewState = view
    ? createViewState(source, { viewId: 'inventory', sourceId: 'parts' })
    : undefined;
  if (viewState)
    viewState.columnOptions = {
      1: { kind: 'number', decimals: 1 },
      2: { kind: 'select', options: ['Available', 'On order'] },
    };
  return createSpreadsheet({ source, viewState });
}
const labels = ['Part', 'Quantity', 'Availability', 'Double quantity'];
const getColumnLabel = (col: number) => labels[col];
function Example() {
  // The application owns the stores. Unmounting Spreadsheet never disposes its store.
  const [stores, setStores] = useState<ReturnType<typeof createInventory>[] | null>(null);
  const [showFirst, setShowFirst] = useState(true);
  useEffect(() => {
    const instances = [createInventory(false), createInventory(true)];
    setStores(instances);
    return () => instances.forEach((store) => store.dispose());
  }, []);
  if (!stores) return <p>Preparing inventories…</p>;
  return (
    <div className="example">
      <h1>Two independent inventories</h1>
      <p>One plain store, one configurable view. Neither needs persistence.</p>
      <button data-testid="toggle-first" onClick={() => setShowFirst((value) => !value)}>
        Toggle first spreadsheet
      </button>
      <div className="cell" data-testid="host-cell">
        Host content keeps its own styles
      </div>
      {showFirst && (
        <Spreadsheet
          store={stores[0]}
          title="Stockroom"
          height={260}
          getColumnLabel={getColumnLabel}
          renderToolbar={(sheet) => (
            <Button variant="outline" onClick={() => sheet.select({ row: 99, col: 1 })}>
              Jump to item 100
            </Button>
          )}
        />
      )}
      <Spreadsheet
        store={stores[1]}
        title="Workshop"
        height={280}
        locale="cs-CZ"
        getColumnLabel={getColumnLabel}
        className="workshop-theme"
      />
    </div>
  );
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Example />
  </StrictMode>,
);
