# Data and persistence adapters

## DataSource

Import the interface from `@sheet/core`. Its required contract is:

```ts
interface DataSource {
  readonly mode: 'local' | 'remote';
  readonly metadata: { rows: number; columns: number; revision: number };
  rowId(row: number): string;
  columnId(col: number): string;
  isEditable(address: Address): boolean;
  getBlock(range: CellRange, signal: AbortSignal): Promise<DataBlock>;
  mutate(mutation: Mutation, revision: number, signal: AbortSignal): Promise<{ revision: number }>;
  getColumnFormula(col: number): string | null;
  subscribe(listener: (event: SourceEvent) => void): () => void;
  dispose(): void;
}
```

These referenced types are exported from `@sheet/core`. A `DataBlock` includes its inclusive `range`, `revision` and `cells`: records containing `row`, `col`, `input`, `value` and `status`. `Mutation` accepts optional cell patches and column formula changes. `SourceEvent` carries revision and optional connection/error/mapping/query status.

The base source uses stable source indexes. View wrappers map visible requests to canonical identities. Return actual empty values as `null`, never unloaded placeholders. Honor `AbortSignal`, reject stale writes and publish monotonic revisions. `dispose()` releases subscriptions and transport resources.

Optional capabilities are `view`, `getSummary(range, signal)`, `getViewRows(view, signal)`, `getViewSummary(view, range, signal)` and `getViewBlocks(view, ranges, signal)`. Query rows return a packed `Uint32Array` plus revision; view blocks return `{ blocks, revision }`. Summaries return count, numeric count, sum, average, minimum, maximum and revision.

## createLocalSource(options)

Exported by `@sheet/transport`; returns a `DataSource` synchronously.

| Option              | Meaning                                     |
| ------------------- | ------------------------------------------- |
| `metadata`          | Required dimensions and initial revision    |
| `calculator`        | Required `CalculationAdapter`               |
| `columnFormulas`    | Optional initial row-zero formula templates |
| `editable(address)` | Optional edit policy, default all editable  |

A `CalculationAdapter` implements `calculate(range, signal)`, `apply(mutation, revision, signal)` and `dispose()`. Configured views additionally use `calculateView`, `queryView` and `summarizeView`. All calculation/mutation methods return promises.

`new WorkerCalculationAdapter(worker)` provides these operations over worker RPC. In the worker, call `installCalculationWorker(new EngineSession(engine), self)`. See the [worker setup](../guides/data-sources.md#local-worker).

## createHttpSource(options)

Exported by `@sheet/transport`; returns `Promise<DataSource>`. It rejects if initial metadata cannot load.

| Option             | Meaning                                                         |
| ------------------ | --------------------------------------------------------------- |
| `baseUrl`          | Required endpoint prefix, for example `/api/sheet`              |
| `fetch`            | Optional request implementation, defaults to `globalThis.fetch` |
| `eventSource(url)` | Optional SSE factory, defaults to native `EventSource`          |
| `signal`           | Optional abort signal for initial connection                    |

Disposal closes the event stream and aborts reconnect metadata requests. Per-operation signals control block and mutation requests. Non-successful responses reject; connection failures also arrive through source events. See [HTTP endpoints](../use-cases/server-reporting.md#endpoint-contract).

## ViewPersistenceAdapter

Import the interface from `@sheet/core`:

```ts
interface ViewPersistenceAdapter {
  list?(sourceId: string, signal: AbortSignal): Promise<ViewSummary[]>;
  load(viewId: string, signal: AbortSignal): Promise<PersistedView | null>;
  save(
    state: SheetViewState,
    expectedVersion: string | null,
    signal: AbortSignal,
  ): Promise<PersistedView>;
}
```

`PersistedView` is `{ state, version }`; `ViewSummary` is `{ viewId, name, sourceId }`. `null` from `load` means no saved view. `save` uses optimistic concurrency; a mismatching expected version rejects instead of overwriting another session.

Built-in implementations from `@sheet/transport`:

| Constructor                                                   | Behavior                                                                                      |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `new LocalStorageViewAdapter(storage, prefix?)`               | Pass browser storage explicitly; default prefix `ledger:view:`. Uses Web Locks when available |
| `new HttpViewAdapter(baseUrl, request?)`                      | Catalog GET, view GET and conditional PUT; HTTP 409 becomes a conflict error                  |
| `new ViewPersistenceBinding(view, adapter, version?, delay?)` | Autosave binding, default version `null`, debounce `300` ms                                   |

The binding exposes `subscribe`, `getSnapshot`, `flush` and `dispose`. It queues changes during an in-flight save. `flush()` records failures in status rather than rejecting; inspect status before a view switch. Construct adapters only in a browser lifecycle when passing `localStorage`. See [persistence workflow](../views.md).
