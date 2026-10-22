import { Spreadsheet } from '@sheet/ui';
import type { CellInput } from '@sheet/core';
import { createExampleStore } from './create-example-store';
import { useExample } from './use-example';

const labels = ['Service', 'Quantity', 'Unit price', 'Discount', 'Line total'];
const getColumnLabel = (column: number) => labels[column];
function createStores() {
  const rows: CellInput[][] = [
    ['Design', 12, 85, 0, '=B1*C1*(1-D1)'],
    ['Development', 24, 110, 0.1, '=B2*C2*(1-D2)'],
    ['Review', 4, 85, 0, '=B3*C3*(1-D3)'],
    ['Total', null, null, null, '=SUM(E1:E3)'],
  ];
  return [
    createExampleStore(
      {
        rows: 12,
        columns: 5,
        readInput: ({ row, col }) => rows[row]?.[col] ?? null,
      },
      {
        columnOptions: {
          1: { kind: 'number', decimals: 0 },
          2: { kind: 'currency', currency: 'EUR', decimals: 2 },
          3: { kind: 'percent', decimals: 0 },
          4: { kind: 'currency', currency: 'EUR', decimals: 2 },
        },
      },
    ),
  ];
}
export default function Quotation() {
  const stores = useExample(createStores);
  if (!stores) return <p>Preparing quotation…</p>;
  return (
    <Spreadsheet
      store={stores[0]}
      title="Website quotation"
      height={360}
      getColumnLabel={getColumnLabel}
    />
  );
}
