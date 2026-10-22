# Server-backed reporting

Keep complete records and authoritative calculations on the server when the dataset is too large or too sensitive to send to a browser. The browser requests bounded blocks; a formula such as `=SUM(G1:G1000000)` must still aggregate the complete source.

## Run the reference integration

```bash
pnpm dev
```

Open `http://127.0.0.1:5173` and select the live server workbook. The reference API runs on `127.0.0.1:4317`; it generates one million sales rows and sends updates every four seconds. The first six source columns are read-only. Custom calculated columns belong to the view.

This recipe requires the API. The embedded documentation examples are local and do not simulate a server connection.

## Endpoint contract

`createHttpSource({ baseUrl: '/api' })` expects these endpoints below its base URL:

| Request                          | Contract                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------ |
| `GET /meta`                      | `{ rows, columns, revision, columnFormulas, editableColumns }`                       |
| `GET /block?r0=…&r1=…&c0=…&c1=…` | Inclusive range; returns `{ range, revision, cells }`                                |
| `POST /mutate`                   | `{ revision, mutation }`; returns current metadata; conflicting revision is HTTP 409 |
| `GET /events`                    | SSE messages carrying updated metadata and revision                                  |
| `POST /view-blocks`              | `{ view, ranges }`; returns `{ blocks, revision }`                                   |
| `POST /view-query`               | `{ view }`; packed Uint32 row indexes, revision in `X-Sheet-Revision`                |
| `POST /view-summary`             | `{ view, range }`; selection summary over the complete query result                  |

Each cell record includes zero-based coordinates, original input, computed value and status. The implementation in `apps/server` is the executable protocol reference. Preserve the packed row-index encoding when replacing the server implementation.

Persisted views use a separate `HttpViewAdapter`: catalog `GET ?sourceId=…`, `GET /:viewId`, and `PUT /:viewId` with `{ state, expectedVersion }`. A missing view returns 404; a version conflict returns 409.

## Production integration choices

Authenticate requests and authorize source/view access in your application. Decide which columns or cells can be written, validate mutations on the server and reject stale revisions. The demo's generated data and in-memory persistence are not production storage.

Do not implement block loading by giving the formula engine an incomplete array with blanks for missing pages. Calculate against your authoritative dataset or implement the `DataSource` interface around an existing calculation service. Test latency, source updates and formula-heavy selections with realistic data; see [performance boundaries](../performance.md).

Use the [async lifecycle pattern](../guides/lifecycle.md#async-sources) to cancel a connection on unmount and close the event stream when finished.
