import { Spreadsheet } from '@sheet/ui';
import { createExampleStore } from './create-example-store';
import { useExample } from './use-example';

function createStores() {
  return [10, 25].map((quantity) =>
    createExampleStore({
      rows: 20,
      columns: 4,
      cells: [
        { row: 0, col: 0, input: quantity },
        { row: 0, col: 1, input: '=A1*2' },
      ],
    }),
  );
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
