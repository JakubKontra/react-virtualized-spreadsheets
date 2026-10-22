import { useState } from 'react';
import { CanonicalCol, type SpreadsheetStore } from '@sheet/core';
import { Spreadsheet, Button } from '@sheet/ui';
import { createExampleStore } from './create-example-store';
import { useExample } from './use-example';

const labels = ['Part', 'Stock', 'Status', 'Unit price', 'Stock value'];
const getColumnLabel = (column: CanonicalCol) => labels[column];
const STOCK = CanonicalCol.of(1);
function createStores(): readonly [SpreadsheetStore] {
  return [
    createExampleStore(
      {
        rows: 300,
        columns: 5,
        readInput: ({ row, col }) =>
          [
            `Part ${String(row + 1).padStart(3, '0')}`,
            row % 20,
            row % 3 === 0 ? 'On order' : 'Available',
            12.5,
            `=B${row + 1}*D${row + 1}`,
          ][col] ?? null,
      },
      {
        frozen: { rows: 0, columns: 1 },
        columnOptions: {
          1: { kind: 'number', decimals: 0 },
          2: { kind: 'select', options: ['Available', 'On order'] },
          3: { kind: 'currency', currency: 'EUR', decimals: 2 },
          4: { kind: 'currency', currency: 'EUR', decimals: 2 },
        },
        conditionalRules: [
          {
            id: 'low-stock',
            col: STOCK,
            operator: 'lt',
            value: 5,
            color: '#92400e',
            background: '#fef3c7',
          },
        ],
      },
    ),
  ];
}
export default function Inventory() {
  const stores = useExample(createStores);
  const [lowStock, setLowStock] = useState(false);
  if (!stores) return <p>Preparing inventory…</p>;
  const [store] = stores;
  return (
    <Spreadsheet
      store={store}
      title="Parts inventory"
      getColumnLabel={getColumnLabel}
      height={360}
      renderToolbar={(sheet) => (
        <Button
          variant="outline"
          aria-pressed={lowStock}
          disabled={sheet.state.pending || sheet.state.querying}
          onClick={() => {
            sheet.edit
              .commit()
              .then((committed) => {
                if (!committed) return;
                const next = !lowStock;
                store.configure({
                  query: { filters: next ? [{ col: STOCK, operator: 'lt', value: 5 }] : [] },
                });
                setLowStock(next);
              })
              .catch((error: unknown) => store.setError(error));
          }}
        >
          {lowStock ? 'Show all stock' : 'Show low stock'}
        </Button>
      )}
    />
  );
}
