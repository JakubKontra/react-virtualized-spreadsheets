# Changelog

## Unreleased

A type-safety release. All four packages compile under `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and `verbatimModuleSyntax`, with no `any`, no non-null assertions and only audited casts (enforced by `scripts/check-type-safety.mjs`). **This release breaks the public API.** Behaviour, limits and error messages are unchanged.

### Branded coordinates

Row and column indices are now branded per axis and per coordinate space, so a column cannot be passed where a row is expected, and a canonical (persisted) index cannot be passed where a visible grid position is expected.

| Space       | Types                          | Used for                                                             |
| ----------- | ------------------------------ | -------------------------------------------------------------------- |
| `visible`   | `RowIndex`, `ColIndex`         | Grid positions, selection, store and DataSource addresses            |
| `logical`   | `LogicalRow`, `LogicalCol`     | A1 labels and formula references, including hidden items             |
| `canonical` | `CanonicalRow`, `CanonicalCol` | Persisted view data: filters, sorts, column options, formulas, sizes |

Construct them with `RowIndex.of(n)` (validated) or `RowIndex.unsafe(n)`, and addresses with `Address.of(row, col)` / `Address.unsafe(row, col)`. `Revision`, `ViewRevision`, `ViewId`, `SourceId`, `RowId` and `ColumnId` are branded too.

### Migration

| Before                                                        | After                                                                                     |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `{ row: 1, col: 2 }`                                          | `Address.of(1, 2)`                                                                        |
| `normalizeRange`, `contains`                                  | `CellRange.normalize`, `CellRange.contains`                                               |
| `parseAddress(label)`                                         | `parseA1(label)`                                                                          |
| `addressFromKey(key)`                                         | `parseCellKey(key)` (returns `null` for invalid keys)                                     |
| `{ cells }` / `{ columns }` mutations                         | `{ kind: 'cells', cells }` / `{ kind: 'columns', columns }`                               |
| `SourceEvent` with optional fields                            | Union discriminated by `type`: `revision`, `query`, `connection`, `error`                 |
| `getViewRows`, `getViewSummary`, `getViewBlocks`              | One `views: { query, summary, blocks }` capability                                        |
| `DataSource.getSummary`                                       | `DataSource.summary`                                                                      |
| `createSpreadsheet({ source, viewState, onViewStateChange })` | `createSpreadsheet({ source, view: { state, onChange } })`                                |
| `ViewAxis.visibleIndex` / `logicalIndex` returning `-1`       | Return `undefined`                                                                        |
| `ColumnOptions` with optional `decimals`/`currency`/`options` | Union discriminated by `kind`; `withColumnKind(option, kind)`                             |
| `ColumnFilter` with optional `value`                          | Union: presence operators take no value; `withFilterOperator`                             |
| `WorkerRpc`, `request<T>(method: string, payload)`            | `RpcClient<Protocol>` with typed `request(method, params)`                                |
| Worker messages `{ id, method, payload }`                     | `{ kind: 'request', id, method, params }`; replies carry `ok` and a serialized error code |
| HTTP `/mutate` body `{ mutation: { columns }, revision }`     | `{ mutation: { kind: 'columns', columns }, revision }`                                    |
| `useCell(store, row, col)`                                    | `useCell(store, address)`                                                                 |
| `useSelectionSummary(store, range, revision, querying)`       | `useSelectionSummary(store, { range, revision, enabled })`                                |
| `summary.value` / `summary.loading` / `summary.error`         | `summary.status`: `idle`, `loading`, `ready` (with `value`) or `error`                    |
| `sheet.virtualRows`, `sheet.totalWidth`, `sheet.cellRect`, …  | `sheet.layout.*`                                                                          |
| `sheet.startEdit(initial, address)`                           | `sheet.edit.start({ initial, address })`                                                  |
| `sheet.commitEdit(text, move, restoreFocus)`                  | `sheet.edit.commit({ text, move: 'down', restoreFocus })`                                 |
| `sheet.select(address, extend)`, `sheet.scrollToCell`         | `sheet.navigation.select(address, { extend })`, `sheet.navigation.scrollToCell`           |
| `sheet.gridProps`, `sheet.getCellProps`, `sheet.editorProps`  | `sheet.props.grid`, `sheet.props.cell(address)`, `sheet.props.editor`                     |
| `sheet.formulaBarProps`, `sheet.fillHandleProps`              | `sheet.props.formulaBar`, `sheet.props.fillHandle`                                        |
| `sheet.gestures.setMenu(null)`                                | `sheet.gestures.closeMenu()`                                                              |

### Added

- `SheetError` with a machine-readable `code` on every library error; codes survive worker and HTTP boundaries.
- Runtime parsers for untrusted data (`parse` namespace, `parseViewState`, `parseRemoteMetadata`, `parseDataBlock`, `parseMutation`, …). Saved views, HTTP responses and server request bodies are validated instead of cast.
- `store.commitDraft(text, address)` parses and writes a draft, including calculated-column templates on remote sources.
- `CalculationProtocol`, `createCalculationHandlers` and `serveRpc` for building custom calculation workers.
- Low-level React hooks (`useGridLayout`, `useEditSession`, `useSheetGestures`, `useRangeDrag`) and the pure `resolveGridKey` keyboard resolver.
- `CELL_KINDS`, `FILTER_OPERATORS`, `SORT_DIRECTIONS` and `PASTE_MODES` tuples with type guards.

## 0.1.0-beta.1

First public beta of **react-virtualized-spreadsheets**. The four `@sheet/*` packages are distributed as GitHub release archives. They are not published to npm, and APIs may change before a stable release.

Licensed under MIT.

### Included

- Headless React hooks with two-axis virtualization and a bounded cell cache.
- Optional shadcn/ui renderer with keyboard editing, formula assistance, menus and per-instance themes.
- Formula evaluation, relative/absolute references, autofill, clipboard modes and undo/redo.
- View-only row/column moves, insertion, hiding, custom-item removal, resizing and frozen panes.
- Sorting, filtering, typed columns, conditional formatting and selection summaries.
- Local calculation workers, HTTP/SSE sources and localStorage/HTTP view persistence.
- Docusaurus documentation, four interactive examples, integration recipes, API reference and roadmap.

### Beta boundaries

The formula engine implements a documented Excel-style subset. XLSX import/export, merged cells, charts, cross-sheet formulas and collaborative editing are not implemented. Undo history is local to the current session. Large datasets and assistive technologies need validation in the consuming application's target browsers and devices.

See the documentation for transaction/cache limits, formula semantics, measured performance and installation instructions.
