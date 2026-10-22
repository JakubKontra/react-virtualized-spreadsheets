import type { SpreadsheetStore } from '@sheet/core';
import { Spreadsheet } from '@sheet/ui';
import { cell, createExampleStore } from './create-example-store';
import { useExample } from './use-example';

function createWarehouse(quantity: number): SpreadsheetStore {
  return createExampleStore({
    rows: 20,
    columns: 4,
    cells: [cell(0, 0, quantity), cell(0, 1, '=A1*2')],
  });
}
function createStores(): readonly [SpreadsheetStore, SpreadsheetStore] {
  return [createWarehouse(10), createWarehouse(25)];
}
export default function Independent() {
  const stores = useExample(createStores);
  if (!stores) return <p>Preparing both spreadsheets…</p>;
  return (
    <>
      <Spreadsheet store={stores[0]} title="Warehouse A" height={200} />
      <Spreadsheet store={stores[1]} title="Warehouse B" height={200} className="second-sheet" />
    </>
  );
}
