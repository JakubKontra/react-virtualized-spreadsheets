import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Address,
  createSpreadsheet,
  createViewState,
  EngineSession,
  FormulaEngine,
  ViewCalculationRegistry,
  type ViewCapableCalculator,
  type CanonicalCol,
  type CellInput,
  type SpreadsheetStore,
  type ViewSettings,
} from '@sheet/core';
import { createLocalSource } from '@sheet/transport';
import { Spreadsheet, Button } from '@sheet/ui';
import './style.css';

function readInventory({ row, col }: Address): CellInput {
  switch (col) {
    case 0:
      return `Part ${row + 1}`;
    case 1:
      return 12.5 + row;
    case 2:
      return 'Available';
    case 3:
      return `=B${row + 1}*2`;
    default:
      return null;
  }
}

/** Main-thread calculations; the inventory is small and complete. */
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

function createInventory(withView: boolean): SpreadsheetStore {
  const session = new EngineSession(
    new FormulaEngine({ rows: 300, columns: 8, readInput: readInventory }),
  );
  const source = createLocalSource({
    metadata: session.metadata,
    calculator: inProcessCalculator(session),
  });
  if (!withView) return createSpreadsheet({ source });
  const settings: ViewSettings = {
    columnOptions: {
      1: { kind: 'number', decimals: 1 },
      2: { kind: 'select', options: ['Available', 'On order'] },
    },
  };
  const state = {
    ...createViewState(source, { viewId: 'inventory', sourceId: 'parts' }),
    ...settings,
  };
  return createSpreadsheet({ source, view: { state } });
}
const labels = ['Part', 'Quantity', 'Availability', 'Double quantity'];
const getColumnLabel = (col: CanonicalCol) => labels[col];
const ITEM_100 = Address.of(99, 1);
function Example() {
  // The application owns the stores. Unmounting Spreadsheet never disposes its store.
  const [stores, setStores] = useState<readonly [SpreadsheetStore, SpreadsheetStore] | null>(null);
  const [showFirst, setShowFirst] = useState(true);
  useEffect(() => {
    const instances: readonly [SpreadsheetStore, SpreadsheetStore] = [
      createInventory(false),
      createInventory(true),
    ];
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
            <Button variant="outline" onClick={() => sheet.navigation.select(ITEM_100)}>
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
const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');
createRoot(container).render(
  <StrictMode>
    <Example />
  </StrictMode>,
);
