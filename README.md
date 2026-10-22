# react-virtualized-spreadsheets

A headless TypeScript spreadsheet with two-axis virtualization, a small formula engine, and interchangeable local-worker / server data sources. The optional `@sheet/ui` package adds a reusable shadcn/ui renderer; the sales workbook demonstrates its integration.

## Documentation

Run `pnpm dev:docs` and open **http://127.0.0.1:3000** for the Docusaurus documentation, live examples, use cases, API reference, roadmap and contribution guide. The examples work without the demo API.

- [Get started](docs/getting-started/overview.md) · [Installation](docs/getting-started/installation.md)
- [Roadmap](docs/roadmap.md) · [Contributing](CONTRIBUTING.md)
- `pnpm build:docs` builds static output; `pnpm serve:docs` previews it with local search.
- `pnpm test:docs` builds and runs documentation browser checks. Set `DOCS_BASE_URL=/spreadsheet/` to check subpath hosting.

Documentation lives in `docs/`; site configuration lives in `apps/docs`. Set `DOCS_URL`, `DOCS_BASE_URL`, and optionally `DOCS_REPOSITORY_URL` / `DOCS_REPOSITORY_BRANCH` before building for a host. No deployment is performed by these commands.

## Run

Node 22.13+ and pnpm 10:

```sh
pnpm install
pnpm dev
```

Open **http://127.0.0.1:5173**. The demonstration API binds to `127.0.0.1:4317`; set `SHEET_PORT` for both processes to change it.

- **Local workbook:** 100,000 × 50 cells; edit any cell, use the formula bar, or paste a range. The fixture generates six source columns and two formula columns lazily in a browser worker.
- **Live server:** 1,000,000 × 50 cells; six source columns are read-only. Editing a custom calculated column changes its template within this view. Upstream sales update every four seconds. **Add calculation** inserts a column beside the active cell with a sum over all source rows, including rows never loaded into the browser.
- Drag a header handle to move rows/columns; a boundary line previews the drop. Shift-click headers for a block, drag their edge to resize, or open the header actions. Source items can be hidden/restored; inserted custom items can be removed. All changes are view-only and undoable.
- Freeze rows/columns; drag the selection's fill handle to extend numbers, dates or relative formulas. Ctrl/⌘ D/R fills down/right.
- The formula editor suggests functions, explains arguments and colors references. After `=`, an operator or an opening parenthesis, click/drag cells to insert a reference. F4 (or **Toggle $ reference**) cycles absolute anchors in either editor; the floating help shows matching parentheses and syntax diagnostics without evaluating unfinished formulas.
- **Paste special** captures Ctrl/⌘ V in a dialog and previews the target dimensions. Paste original contents, computed values, or only formulas; optionally transpose rows and columns. Formulas-only skips constants and leaves their targets unchanged. One Undo reverses the entire paste.
- Formulas include `SUMIF`, `COUNTIF`, `IFERROR`, `ROUND`, `AND`, `OR` and `NOT`, alongside the original aggregates and `IF`. Conditional aggregates operate on the complete source, including unloaded rows.
- **Sort & filter** combines up to three sort keys, eight filters and full-dataset text search. The footer calculates count, sum, average, minimum and maximum for the entire selection.
- **Format** configures numbers, currencies, percentages, dates, checkboxes and choice lists, with conditional colors. **Views** (or the current view name) saves, duplicates, renames and switches workbook views.
- Enter / F2 starts editing; Escape cancels; Tab / arrows navigate; Shift extends selection; Ctrl/⌘ C/V and Z/Shift-Z handle clipboard and history. The address box jumps directly to a cell.

The demo saves each local/server view separately in localStorage, including inputs, formulas, order, hidden items, sizes, queries, formats and frozen panes. Reload restores the view; undo history lasts for the current session. The generated sales source stays in memory. It does not connect to Cartop or modify real sales records.

## Packages

| Package            | Responsibility                                                                                                          |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `@sheet/core`      | Sparse formula engine, compact view state, dependency graph, block cache, selection, transactions, clipboard, undo/redo |
| `@sheet/react`     | `useSpreadsheet`, `useCell`, `useSpreadsheetState`; virtual viewport and unstyled interaction props                     |
| `@sheet/ui`        | Optional shadcn/ui renderer, scoped theme styles, dialogs and header actions; consumer-owned Tailwind 4                 |
| `@sheet/transport` | Browser worker RPC, HTTP/SSE, localStorage/HTTP view persistence; no browser globals at module import                   |

`pnpm build` generates ESM and TypeScript declarations for all four packages and both example frontends. The headless hooks support React 18+; `@sheet/ui` requires React 19+ and Tailwind 4. These packages are workspace packages; they have not been published to npm.

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

Cells accept `string | number | boolean | null`. Strings beginning with `=` are formulas. A leading apostrophe escapes literal text: input `'=1+1` displays `=1+1`, and `''quoted` displays `'quoted`. The editor and persistence retain the escape character; calculated values do not. Coordinates are zero-based. `columnFormulas` are templates anchored to row zero; relative references shift for each row. Per-cell inputs override a template in local mode. Clearing a generated local cell stores an explicit null override.

## Render with shadcn/ui

Import `tailwindcss` and `@sheet/ui/styles.css` in your application CSS, then render `<Spreadsheet store={store} />` from `@sheet/ui`. The host owns the store, optional persistence and custom toolbar actions. See [UI integration](docs/ui.md) for setup, props, theme tokens and the independent two-spreadsheet example.

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

The editor is outside virtualized rows, so manual scrolling does not discard its draft or focus. Keep `columnWidth` callbacks stable. `useCell` subscribes to one cell, independently of selection and viewport subscriptions. The headless packages do not require a stylesheet, component kit, router, or React context provider.

The optional UI renderer adds sticky headers, drag previews, header actions, a shared formula-bar draft, focus styling, save/error/connection states and keyboard hints. `grid.gestures` exposes unstyled header, drag and resize props plus preview geometry. See [view state and persistence](docs/views.md) for the full contract. The returned grid and cell props include ARIA row/column counts, indexes, active descendant, selection and read-only state. Screen-reader behavior across browser combinations has not been manually audited.

## Store and source contract

- `store.select(address, extend?)`, `beginEdit()`, `cancelEdit()` control interaction state.
- `store.edit(patches)` is one undoable transaction. `paste(text, options?)`, `clearSelection()`, `undo()` and `redo()` are asynchronous. Catch rejected operations and surface `state.error`.
- `PasteOptions` accepts `mode: 'all' | 'values' | 'formulas'` (default `all`), `transpose` (default false), and `useInternalFormulas` (default true). The legacy boolean second argument remains supported. Browser integrations must enable internal data only when the clipboard's `CLIPBOARD_MIME` token matches `store.getClipboardToken()`; pass false for external text. Values mode uses typed results captured at copy time; formula mode skips non-formulas. Native Ctrl/⌘ V retains its existing behavior.
- `store.setColumnFormula(col, formula | null)` updates a template. In remote mode, `useSpreadsheet().commitEdit()` converts a row-specific formula back to its first-row template.
- `ensureRange(range)` preloads bounded blocks; `readCell(address)` returns a stable snapshot. Missing cells are `loading`, never zero. Existing results become `calculating` when invalidated.
- `source.rowId()` and `columnId()` identify stable rows and columns. Configure `viewState` to enable structural operations. `store.changeView()` moves, inserts, hides, restores, removes custom items or resizes, with undo. `store.view` exposes the compact mapping; `logicalAddress()` / `labelAddress()` include hidden items.
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

Without `viewState`, mutations use the original source revision contract. With `viewState`, calculations use an isolated overlay and never call source mutation endpoints. `POST /view-blocks` receives `{ view, ranges }` in canonical coordinates and returns `{ blocks, revision }` for the source revision. Persist view definitions separately using a versioned adapter; conflicts retain local changes. The demo exposes `GET/PUT /api/views/:viewId` backed by an in-memory map as a reference. See [the integration contract](docs/views.md).

## Formula semantics and performance

See [formula support](docs/formulas.md), [feature APIs](docs/views.md#queries-formatting-and-frozen-panes) and [performance methodology](docs/performance.md).

This version supports one sheet with variable row heights and column widths. Structural edits affect a view, not the source dataset. It does not include XLSX, charting, merged cells or collaborative editing. Conditional formatting currently supports comparisons, text matching and empty/nonempty checks. Freeze panes and formatting require a view-enabled store; the headless renderer controls how they appear. Formula syntax is a documented subset, not a drop-in Excel engine. Financial values use JavaScript floating-point arithmetic; formatting does not alter the underlying value.

## Verification

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
pnpm test:ui-package
pnpm benchmark
pnpm benchmark:browser
```

Benchmark JSON is written to the ignored `benchmark-results/` directory. Browser tests run against local dev servers and do not need a cloud service.
