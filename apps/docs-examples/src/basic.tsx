import { Spreadsheet } from '@sheet/ui';
import { createExampleStore } from './create-example-store';
import { useExample } from './use-example';

function createStores() {
  return [
    createExampleStore({
      rows: 100,
      columns: 8,
      cells: [
        { row: 0, col: 0, input: 120 },
        { row: 1, col: 0, input: 80 },
        { row: 2, col: 0, input: '=SUM(A1:A2)' },
        { row: 0, col: 1, input: '=A1*1.21' },
      ],
    }),
  ];
}
export default function Basic() {
  const stores = useExample(createStores);
  if (!stores) return <p>Preparing spreadsheet…</p>;
  return <Spreadsheet store={stores[0]} title="First spreadsheet" height={360} />;
}
