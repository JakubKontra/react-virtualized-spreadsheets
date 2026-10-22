# Data and persistence adapters

## DataSource

Import the interface from `@sheet/core`. Its required contract is:

```ts
interface DataSource {
  readonly mode: 'local' | 'remote';
  readonly metadata: { rows: number; columns: number; revision: Revision };
  rowId(row: RowIndex): RowId;
  columnId(col: ColIndex): ColumnId;
  isEditable(address: Address): boolean;
  getBlock(range: CellRange, signal: AbortSignal): Promise<DataBlock>;
  mutate(mutation: Mutation, expected: Revision, signal: AbortSignal): Promise<MutationResult>;
  getColumnFormula(col: ColIndex): Formula | null;
  subscribe(listener: (event: SourceEvent) => void): () => void;
  dispose(): void;
  readonly summary?: (range: CellRange, signal: AbortSignal) => Promise<SelectionSummary>;
  readonly views?: ViewCapability;
}
```

These referenced types are exported from `@sheet/core`. Indices and revisions are branded; see [coordinates](../guides/coordinates.md). A `DataBlock` includes its inclusive `range`, `revision` and `cells`: records containing `row`, `col`, `input`, `value`, `status` and an optional `message`. `MutationResult` is `{ revision }`.

`Mutation` is a union discriminated by `kind`: either cell patches or calculated-column formulas, never both.

```ts
type Mutation =
  | { kind: 'cells'; cells: readonly CellPatch[] }
  | { kind: 'columns'; columns: readonly { col: ColIndex; formula: Formula | null }[] };
```

`SourceEvent` is a union discriminated by `type`. Every event carries a `revision`:

| `type`       | Additional fields                                             |
| ------------ | ------------------------------------------------------------- |
| `revision`   | Optional `mappingChanged`                                     |
| `query`      | `querying`, optional `mappingChanged` and `error`             |
| `connection` | `connection: 'connected' \| 'disconnected'`, optional `error` |
| `error`      | `error`                                                       |

The base source uses stable source indexes. View wrappers map visible requests to canonical identities. Return actual empty values as `null`, never unloaded placeholders. Honor `AbortSignal`, reject stale writes and publish monotonic revisions. `dispose()` releases subscriptions and transport resources.

### Optional capabilities

`summary(range, signal)` computes a `SelectionSummary` (count, numeric count, sum, average, minimum, maximum and revision) over the source rather than loaded cells.

`views` is a `ViewCapability` that evaluates whole-dataset calculations over a view overlay. It is required to configure a view; a source that has it is a `ViewCapableSource` (narrow with `hasViews(source)`).

```ts
interface ViewCapability {
  query(view: SheetViewState, signal: AbortSignal): Promise<ViewRows>;
  summary(view: SheetViewState, range: CellRange, signal: AbortSignal): Promise<SelectionSummary>;
  blocks(
    view: SheetViewState,
    ranges: readonly CellRange<'canonical'>[],
    signal: AbortSignal,
  ): Promise<ViewBlocks>;
}
```

`query` returns `{ rows, revision }`, where `rows` is a packed `Uint32Array` of canonical row indices in display order. `blocks` returns `{ blocks, revision }` with blocks addressed by canonical row and column. The store wraps a configured source in a `ViewedSource` (`isViewed(source)`), which adds the `view` controller.

## createLocalSource(options)

Exported by `@sheet/transport`; returns a source synchronously. The result is a `ViewCapableSource` when the calculator has `views`, otherwise a `DataSource`.

| Option              | Meaning                                                  |
| ------------------- | -------------------------------------------------------- |
| `metadata`          | Required dimensions and initial revision                 |
| `calculator`        | Required `CalculationAdapter`                            |
| `columnFormulas`    | Optional initial row-zero `Formula` templates, by column |
| `editable(address)` | Optional edit policy, default all editable               |

A `CalculationAdapter` implements `calculate(range, signal)`, `apply(mutation, expected, signal)`, `dispose()` and optionally `views`. All calculation and mutation methods return promises. `ViewCapableCalculator` is a calculator with `views`; [`create-example-store.ts`](../getting-started/first-sheet.mdx#2-connect-a-calculation-engine) implements one on the main thread with `ViewCalculationRegistry`.

`new WorkerCalculationAdapter(worker)` provides these operations, including `views`, over a typed worker RPC. In the worker, call `installCalculationWorker(new EngineSession(engine), self)`. See the [worker setup](../guides/data-sources.md#local-worker).

## Worker RPC

`installCalculationWorker` and `WorkerCalculationAdapter` are built from a typed request/response layer. Use it directly for a custom worker that adds methods.

A protocol is a type mapping method names to `{ params, result }`. `CalculationProtocol` defines `block`, `viewBlocks`, `viewQuery`, `viewSummary` and `mutate`. `createCalculationHandlers(session, views?)` returns `Handlers<CalculationProtocol>` for an `EngineSession` and an optional `ViewCalculationRegistry`.

```ts title="calculation.worker.ts"
import { EngineSession, FormulaEngine } from '@sheet/core';
import { createCalculationHandlers, serveRpc, type CalculationProtocol } from '@sheet/transport';

type Protocol = CalculationProtocol & {
  readonly revision: { readonly params: null; readonly result: number };
};

const session = new EngineSession(new FormulaEngine({ rows: 1_000, columns: 4 }));
serveRpc<Protocol>(self, {
  ...createCalculationHandlers(session),
  revision: () => session.revision,
});
```

```ts
import { RpcClient } from '@sheet/transport';

const rpc = new RpcClient<Protocol>(
  new Worker(new URL('./calculation.worker.ts', import.meta.url), { type: 'module' }),
);
const revision = await rpc.request('revision', null);
rpc.dispose(); // Rejects pending requests and terminates the worker.
```

`RpcClient<Protocol, Events>` has `request(method, params, signal?)`, typed by the protocol, `on(event, listener)` for events the handler side pushes with `serveRpc(...).emit(name, data)`, and `dispose()`. Aborting a request rejects it; the handler still runs to completion. A worker `error` event rejects all pending and future requests.

`serveRpc(scope, handlers)` answers requests on any `RpcScope` (`addEventListener('message', listener)` and `postMessage`), such as a worker global or an adapted Node `parentPort`. A thrown error is sent with its `SheetError` code and revived on the client. Wire messages are `{ kind: 'request', id, method, params }`, `{ kind: 'reply', id, ok: true, result }`, `{ kind: 'reply', id, ok: false, error: { code, message } }` and `{ kind: 'event', name, data }`. `apps/server/src/compute.ts` extends the calculation protocol with metadata and events.

## createHttpSource(options)

Exported by `@sheet/transport`; returns `Promise<ViewCapableSource>`. It rejects if initial metadata cannot load.

| Option             | Meaning                                                         |
| ------------------ | --------------------------------------------------------------- |
| `baseUrl`          | Required endpoint prefix, for example `/api/sheet`              |
| `fetch`            | Optional request implementation, defaults to `globalThis.fetch` |
| `eventSource(url)` | Optional SSE factory, defaults to native `EventSource`          |
| `signal`           | Optional abort signal for initial connection                    |

Disposal closes the event stream and aborts reconnect metadata requests. Per-operation signals control block and mutation requests. Non-successful responses reject; connection failures also arrive through source events. JSON response bodies are validated before use. See [HTTP endpoints](../use-cases/server-reporting.md#endpoint-contract).

`HTTP_ROUTES` lists the endpoint paths and `REVISION_HEADER` the `/view-query` revision header, shared with the reference server. `RemoteMetadata` is the `/meta` body: `rows`, `columns`, `revision`, `columnFormulas` and `editableColumns: ColIndex[]`.

## Validation

Data from storage, HTTP and workers is untyped until parsed. A `Parser<T>` is `(input: unknown, path?: string) => T`; it returns a typed value or throws `ValidationError` (a `SheetError` with code `INVALID_INPUT` whose message names the offending path).

| Exports                                                                                                                                                                                     | Package            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `parse` namespace: `object`, `array`, `tuple`, `record`, `str`, `int`, `finite`, `bool`, `literal`, `optional`, `nullable`, `union`, `variant`, `refine`, `map`, `parseJson`, `withMessage` | `@sheet/core`      |
| `parseViewState`, `parsePersistedView`, `parseViewSummaries`, `parseViewSettings(input, columns)`; assertions `validateViewState`, `validateSettings`                                       | `@sheet/core`      |
| `parseRemoteMetadata`, `parseDataBlock`, `parseViewBlocks`, `parseSelectionSummary`, `parseMutation`, `parseMutationRequest`, `parseCellRange`                                              | `@sheet/transport` |

```ts
import { parse, parseViewState } from '@sheet/core';
import { parseMutationRequest } from '@sheet/transport';

const state = parse.parseJson(
  localStorage.getItem('view') ?? 'null',
  parse.nullable(parseViewState),
);
const body = parseMutationRequest(await request.json()); // { mutation, revision }
```

The built-in adapters already validate saved views, HTTP responses and, in the reference server, request bodies. Use the parsers in your own server or storage code.

## Errors

Every library error is a `SheetError` with a machine-readable `code` and the user-facing `message`. Codes survive worker and HTTP boundaries: `serializeError(error)` produces `{ code, message }` (`code` is `'UNKNOWN'` for foreign errors) and `reviveError` restores it. An HTTP 409 response becomes `REVISION_CONFLICT`.

| Code                | Raised when                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------ |
| `REVISION_CONFLICT` | A write or view save was based on a stale revision or version                              |
| `READ_ONLY`         | A cell, column or source item cannot be changed                                            |
| `OUT_OF_BOUNDS`     | An index or address is invalid or outside the sheet or view                                |
| `LIMIT_EXCEEDED`    | A transaction, clipboard, block or resize exceeds its limit                                |
| `INVALID_INPUT`     | Input, a formula or a request body failed validation                                       |
| `INVALID_DOCUMENT`  | A view document is invalid or belongs to a different source                                |
| `DISPOSED`          | The store, source or worker has been disposed                                              |
| `BUSY`              | An operation must wait for an edit, mutation or loading cells                              |
| `DISCONNECTED`      | A remote source is disconnected                                                            |
| `UNSUPPORTED`       | A required capability (such as a view) is missing, or row structure changes during a query |
| `REQUEST_FAILED`    | An HTTP request failed with an unexpected or server-side status                            |

```ts
import { SheetError, errorMessage } from '@sheet/core';

try {
  await store.edit(patches);
} catch (error) {
  if (error instanceof SheetError && error.code === 'REVISION_CONFLICT') store.refresh();
  else store.setError(errorMessage(error));
}
```

`errorMessage(unknown)` extracts a message from any thrown value. `isAbortError(error)` recognizes aborted requests and `abortError()` creates one. Formula evaluation errors such as `#DIV/0!` are cell values, not `SheetError`s.

## ViewPersistenceAdapter

Import the interface from `@sheet/core`:

```ts
interface ViewPersistenceAdapter {
  list?(sourceId: SourceId, signal: AbortSignal): Promise<ViewSummary[]>;
  load(viewId: ViewId, signal: AbortSignal): Promise<PersistedView | null>;
  save(
    state: SheetViewState,
    expectedVersion: string | null,
    signal: AbortSignal,
  ): Promise<PersistedView>;
}
```

`PersistedView` is `{ state, version }` with a string `version`; `ViewSummary` is `{ viewId, name, sourceId }`. `null` from `load` means no saved view. `save` uses optimistic concurrency; a mismatching expected version rejects instead of overwriting another session. Brand string identifiers with `ViewId.unsafe('…')` and `SourceId.unsafe('…')`.

Built-in implementations from `@sheet/transport`:

| Constructor                                                   | Behavior                                                                                      |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `new LocalStorageViewAdapter(storage, prefix?)`               | Pass browser storage explicitly; default prefix `ledger:view:`. Uses Web Locks when available |
| `new HttpViewAdapter(baseUrl, request?)`                      | Catalog GET, view GET and conditional PUT; HTTP 409 becomes a conflict error                  |
| `new ViewPersistenceBinding(view, adapter, version?, delay?)` | Autosave binding, default version `null`, debounce `300` ms                                   |

The binding exposes `subscribe`, `getSnapshot`, `flush` and `dispose`. `getSnapshot()` returns a `ViewSaveStatus`: `{ status: 'saved' | 'saving' | 'unsaved', error: null }` or `{ status: 'error', error: string }`. It queues changes during an in-flight save. `flush()` records failures in status rather than rejecting; inspect status before a view switch. Construct adapters only in a browser lifecycle when passing `localStorage`. See [persistence workflow](../views.md).
