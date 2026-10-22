# Ledger · React spreadsheets

A headless TypeScript spreadsheet with two-axis virtualization, a small formula engine, and interchangeable local-worker / server data sources. The styled sales workbook is an example renderer, not part of the component library.

## Run

Node 22.13+ and pnpm 10:

```sh
pnpm install
pnpm dev
```

Open **http://127.0.0.1:5173**. The demonstration API binds to `127.0.0.1:4317`; set `SHEET_PORT` for both processes to change it.

- **Local workbook:** 100,000 × 50 cells; edit any cell, use the formula bar, or paste a range. The fixture generates six source columns and two formula columns lazily in a browser worker.
- **Live server:** 1,000,000 × 50 cells; six source columns are read-only. Editing G–AX changes that entire calculated column. Upstream sales update every four seconds. **Add calculation** inserts a sum over all source rows, including rows never loaded into the browser.
- Enter / F2 starts editing; Escape cancels; Tab / arrows navigate; Shift extends selection; Ctrl/⌘ C/V and Z/Shift-Z handle clipboard and history. The address box jumps directly to a cell.

This is an in-memory demonstration. Reloading loses edits. It does not connect to Cartop or modify real sales records.

## Packages

| Package            | Responsibility                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `@sheet/core`      | Sparse formula engine, dependency graph, revisioned sessions, block cache, selection, transactions, clipboard, undo/redo |
| `@sheet/react`     | `useSpreadsheet`, `useCell`, `useSpreadsheetState`; virtual viewport and unstyled interaction props                      |
| `@sheet/transport` | Browser worker RPC and HTTP/SSE adapters; no browser globals accessed at module import                                   |

`pnpm build` generates ESM and TypeScript declarations for all three packages and the demonstration frontend. React 18+ is a peer dependency. These packages are workspace packages; they have not been published to npm.

## Supply local data

Create an application-owned worker. Data in this worker must be complete: `readInput` cannot use `null` as a stand-in for a row that has not loaded yet.

```ts
// calculation.worker.ts
import { FormulaEngine, EngineSession } from '@sheet/core';
import { installCalculationWorker } from '@sheet/transport';

const engine = new FormulaEngine({
  rows: 100_000,
  columns: 50,
  cells: [
    { row: 0, col: 0, input: 120 },
    { row: 0, col: 1, input: '=A1*1.21' },
  ],
  // Alternatively: readInput: ({ row, col }) => yourCompleteData[row][col]
});
installCalculationWorker(new EngineSession(engine), self);
```

Create the store once for the mounted workbook and call `dispose()` on unmount. For React Strict Mode, create a fresh store inside each effect setup; do not reuse an instance disposed by effect cleanup. The demo shows this lifecycle, including an aborted remote connection.

```ts
import { createSpreadsheet } from '@sheet/core';
import { createLocalSource, WorkerCalculationAdapter } from '@sheet/transport';

const store = createSpreadsheet({
  source: createLocalSource({
    metadata: { rows: 100_000, columns: 50, revision: 0 },
    calculator: new WorkerCalculationAdapter(
      new Worker(new URL('./calculation.worker.ts', import.meta.url), { type: 'module' }),
    ),
  }),
});
// Later: store.dispose(); terminates the worker and subscriptions.
```

Cells accept `string | number | boolean | null`. Strings beginning with `=` are formulas. Coordinates are zero-based. `columnFormulas` are templates anchored to row zero; relative references shift for each row. Per-cell inputs override a template in local mode. Clearing a generated local cell stores an explicit null override.

## Render with your own components

The hook returns geometry and interaction props. You supply the DOM and CSS. A minimal viewport:

```tsx
import { useRef } from 'react';
import { useCell, useSpreadsheet } from '@sheet/react';
import { isError } from '@sheet/core';
import type { SpreadsheetStore } from '@sheet/core';

function Value({ store, row, col }: { store: SpreadsheetStore; row: number; col: number }) {
  const cell = useCell(store, row, col);
  if (cell.status === 'loading') return <>…</>;
  return <>{isError(cell.value) ? cell.value.error : String(cell.value ?? '')}</>;
}

function Grid({ store }: { store: SpreadsheetStore }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const grid = useSpreadsheet({ store, scrollRef, rowHeaderWidth: 0, columnHeaderHeight: 0 });
  return (
    <div ref={scrollRef} {...grid.gridProps} style={{ height: 500, overflow: 'auto' }}>
      <div style={{ position: 'relative', height: grid.totalHeight, width: grid.totalWidth }}>
        {grid.virtualRows.map((row) => (
          <div
            key={row.key}
            role="row"
            style={{
              position: 'absolute',
              top: row.start,
              height: row.size,
              width: grid.totalWidth,
            }}
          >
            {grid.virtualColumns.map((col) => (
              <div
                key={col.key}
                {...grid.getCellProps({ row: row.index, col: col.index })}
                style={{ position: 'absolute', left: col.start, width: col.size, height: row.size }}
              >
                <Value store={store} row={row.index} col={col.index} />
              </div>
            ))}
          </div>
        ))}
        {grid.state.editing && (
          <input
            {...grid.editorProps}
            autoFocus
            style={{ position: 'absolute', ...grid.cellRect(grid.state.editing) }}
          />
        )}
      </div>
    </div>
  );
}
```

The editor is outside virtualized rows, so manual scrolling does not discard its draft or focus. Keep `columnWidth` callbacks stable. `useCell` subscribes to one cell, independently of selection and viewport subscriptions. The library does not require a stylesheet, component kit, router, or React context provider.

The demo adds sticky headers, focus styling, a formula bar, loading/error/connection states and keyboard hints. The returned grid and cell props include ARIA row/column counts, indexes, active descendant, selection and read-only state. Screen-reader behavior across browser combinations has not been manually audited.

## Store and source contract

- `store.select(address, extend?)`, `beginEdit()`, `cancelEdit()` control interaction state.
- `store.edit(patches)` is one undoable transaction. `paste(text)`, `clearSelection()`, `undo()` and `redo()` are asynchronous. Catch rejected operations and surface `state.error`.
- `store.setColumnFormula(col, formula | null)` updates a template. In remote mode, `useSpreadsheet().commitEdit()` converts a row-specific formula back to its first-row template.
- `ensureRange(range)` preloads bounded blocks; `readCell(address)` returns a stable snapshot. Missing cells are `loading`, never zero. Existing results become `calculating` when invalidated.
- `source.rowId()` and `columnId()` identify stable rows and columns. Reordering and structural changes are outside this version.
- The default cache holds at most 48 blocks of 64 × 8 cells (24,576 snapshots). Each source response contains authoritative computed values and a monotonic revision. Late responses cannot overwrite newer data.
- Editing/paste/delete is capped at 10,000 cells and history at 100 transactions. Selection is unrestricted; copying requires its cells to be loaded, and oversized copies show an error. The cache also bounds the size of ranges preloaded in one operation.
- A disconnected server cannot accept edits. Rejected writes retain the user's draft and undo history. Live source changes are never added to local undo history.

## Cartop / custom server integration

```ts
import { createSpreadsheet } from '@sheet/core';
import { createHttpSource } from '@sheet/transport';

const source = await createHttpSource({ baseUrl: '/api/sales-sheet' });
const store = createSpreadsheet({ source });
```

Implement the following endpoints, or implement the `DataSource` interface directly for your existing API:

| Endpoint                         | Contract                                                                                                             |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `GET /meta`                      | `{ rows, columns, revision, columnFormulas, editableColumns }`                                                       |
| `GET /block?r0=…&r1=…&c0=…&c1=…` | Inclusive range; `{ range, revision, cells: [{ row, col, input, value, status }] }`                                  |
| `POST /mutate`                   | `{ revision, mutation: { columns: [{ col, formula }] } }`; returns current metadata; stale revision returns HTTP 409 |
| `GET /events`                    | SSE `data:` contains current metadata. Reconnection also refetches `/meta`.                                          |

The same-origin adapter uses browser fetch and EventSource. Factories can be injected for application-specific authentication. Production authorization, database persistence, transport limits and multi-user conflict handling belong in the host application.

For sales, keep row IDs and order stable for a sheet session. Formula evaluation belongs on the server with access to the complete dataset. If the backend only reads database pages, provide database-backed aggregation or a complete calculation service; never sum just the browser cache. The demo runs the shared JavaScript engine in a Node worker thread and generates the full synthetic dataset on demand. Its main HTTP thread remains available during calculations, but requests to the calculation worker are serialized.

Revision conflicts preserve the current draft; refresh/retry against current data. In this single-user demo every write checks the current global revision. For production, use a server policy that distinguishes source-data updates from competing formula edits as appropriate. An aborted write may already have reached the server; refresh to discover its authoritative outcome.

## Formula semantics and performance

See [formula support](docs/formulas.md) and [performance methodology](docs/performance.md).

This version intentionally supports one sheet and fixed row heights. It does not include XLSX, charting, autofill, row insertion/deletion, sorting/filtering, merged cells, or collaborative editing. Formula syntax is a documented subset, not a drop-in Excel engine. Financial values use JavaScript floating-point arithmetic; formatting does not alter the underlying value.

## Verification

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
pnpm benchmark
pnpm benchmark:browser
```

Benchmark JSON is written to the ignored `benchmark-results/` directory. Browser tests run against local dev servers and do not need a cloud service.
