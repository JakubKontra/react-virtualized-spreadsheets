import type { SpreadsheetStore } from '@sheet/core';
import { Spreadsheet } from '@sheet/ui';
import { cell, createExampleStore } from './create-example-store';
import { useExample } from './use-example';

function createStores(): readonly [SpreadsheetStore] {
  return [
    createExampleStore({
      rows: 100,
      columns: 8,
      cells: [cell(0, 0, 120), cell(1, 0, 80), cell(2, 0, '=SUM(A1:A2)'), cell(0, 1, '=A1*1.21')],
    }),
  ];
}
export default function Basic() {
  const stores = useExample(createStores);
  if (!stores) return <p>Preparing spreadsheet…</p>;
  return <Spreadsheet store={stores[0]} title="First spreadsheet" height={360} />;
}
