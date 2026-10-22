# Local workers and HTTP sources

The renderer consumes a `SpreadsheetStore`, which consumes a `DataSource`. A source returns **authoritative computed values**, even when a formula references cells outside the browser cache. Choose where the complete data and calculation engine live.

## Local worker

Use a worker for a dataset that fits in the browser but should calculate off the UI thread. The application supplies the worker entry point:

```ts title="calculation.worker.ts"
import { FormulaEngine, EngineSession } from '@sheet/core';
import { installCalculationWorker } from '@sheet/transport';

const engine = new FormulaEngine({
  rows: 100_000,
  columns: 8,
  readInput: ({ row, col }) => (col === 0 ? row + 1 : null),
  columnFormulas: { 1: '=A1*2' },
});
installCalculationWorker(new EngineSession(engine), self);
```

Connect it during the host's lifecycle setup:

```ts
import { createSpreadsheet, createViewState, Revision } from '@sheet/core';
import { createLocalSource, WorkerCalculationAdapter } from '@sheet/transport';

const source = createLocalSource({
  metadata: { rows: 100_000, columns: 8, revision: Revision.initial },
  columnFormulas: { 1: '=A1*2' },
  calculator: new WorkerCalculationAdapter(
    new Worker(new URL('./calculation.worker.ts', import.meta.url), { type: 'module' }),
  ),
});
const store = createSpreadsheet({
  source,
  view: { state: createViewState(source, { viewId: 'default', sourceId: 'my-data' }) },
});
// On host cleanup: store.dispose();
```

`WorkerCalculationAdapter` provides the `views` capability, so this source is a `ViewCapableSource` and can be given a `view`. Keep metadata and initial formula templates consistent between the source and the worker. `readInput` is synchronous and must have access to the complete source. `null` means an actual empty cell, never an unloaded record.

The worker supports block calculation, view projections, selection summaries and mutations. Aborting a request discards its result; it does not interrupt synchronous computation already running in the worker. Disposing the adapter terminates the worker.

## HTTP and server-sent events

```ts
import { createSpreadsheet } from '@sheet/core';
import { createHttpSource } from '@sheet/transport';

const source = await createHttpSource({ baseUrl: '/api/sheet' });
const store = createSpreadsheet({ source });
```

The adapter fetches metadata, requests rectangular blocks and listens to SSE updates. It returns a `ViewCapableSource`, so it also accepts a `view`. JSON response bodies are validated with the transport's parsers. Revisions prevent stale results from overwriting newer data. The server must reject conflicting writes. The renderer reports connection and mutation errors.

Provide `fetch` and `eventSource` factories if the application needs a custom request policy. Native EventSource cannot attach arbitrary authorization headers; use your application's supported authenticated transport. The [server reporting recipe](../use-cases/server-reporting.md) specifies endpoints and the runnable reference server.

## Implement your own source

Implement `DataSource` directly when your backend does not match the HTTP protocol. Preserve stable row and column identities, honor abort signals, and return monotonic revisions. Throw `SheetError` with a matching code (for example `REVISION_CONFLICT` for a stale write) and validate untrusted responses with the `parse` helpers. The store bounds requests and caching; it does not implement authoritative business logic or server authorization.

For configured views, implement the `views` capability: `views.blocks`, `views.query` and `views.summary`. A local calculator exposes the same `views` object, which `createLocalSource` passes through. For selection summaries without a view, implement `summary(range, signal)`. See the [adapter reference](../api/adapters.md).

For a tiny embedded example, an in-memory adapter is sufficient. The [first spreadsheet](../getting-started/first-sheet.mdx) includes that implementation. It deliberately does not demonstrate large-data performance.
