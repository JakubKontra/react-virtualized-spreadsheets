# Store and coordinates

```ts
import { createSpreadsheet, type SpreadsheetStore } from '@sheet/core';
```

`createSpreadsheet(options)` returns a `SpreadsheetStore`. The store owns its source and the optional view wrapper. Call `dispose()` when the host no longer needs it.

## Options

| Option                      | Default  | Purpose                                                 |
| --------------------------- | -------- | ------------------------------------------------------- |
| `source: DataSource`        | Required | Authoritative data and mutation contract                |
| `viewState: SheetViewState` | None     | Enable view layout, filtering, formatting and overrides |
| `onViewStateChange(state)`  | None     | Host notification when the view changes                 |
| `blockRows`                 | `64`     | Cache block row count                                   |
| `blockColumns`              | `8`      | Cache block column count                                |
| `maxBlocks`                 | `48`     | Maximum retained blocks                                 |
| `historyLimit`              | `100`    | Maximum undo transactions                               |

## Coordinate systems

`Address` is `{ row: number, col: number }`; indexes start at zero. `CellRange` is `{ start, end }`; both endpoints are inclusive.

| Space     | Meaning                                                         | Examples                                                 |
| --------- | --------------------------------------------------------------- | -------------------------------------------------------- |
| Visible   | Current displayed positions after hiding/query projection       | `select`, `readCell`, `edit`, `getCellProps`             |
| Logical   | View order including hidden rows/columns; used by A1 references | `logicalAddress`, `labelAddress`                         |
| Canonical | Stable source identity, unchanged by view order                 | View input keys, formats, query columns, label callbacks |

Use `store.resolveAddress('B12')` to turn an A1 label into a visible address; it returns `null` if it cannot resolve to a visible cell. `store.labelAddress(address)` returns the logical A1 label. Do not derive labels from a virtual row index when a query or hidden items are active.

## Read and subscribe

| Member                                       | Result / behavior                                          |
| -------------------------------------------- | ---------------------------------------------------------- |
| `rows`, `columns`                            | Current visible dimensions                                 |
| `view`                                       | Optional `ViewController`                                  |
| `getSnapshot()`                              | Stable `SpreadsheetState` until a change                   |
| `subscribe(listener)`                        | Unsubscribe function                                       |
| `subscribeCell(address, listener)`           | Cell-specific unsubscribe function                         |
| `readCell(address)`                          | `CellSnapshot`; unloaded cells have `loading` status       |
| `ensureRange(range)`                         | `Promise<void>`; loads a bounded inclusive range           |
| `setViewport(range)`, `setViewports(ranges)` | Set active requested regions; normally managed by the hook |
| `refresh()`                                  | Invalidate and reload active regions                       |
| `cacheStats`                                 | Diagnostic cache/request counts                            |

Snapshots include selection, active cell, draft, pending/querying flags, connection status, revision, error and history availability. A formula error is a `{ error, message }` value; check it with `isError`.

## Edit and history

| Method                                            | Result / behavior                                                          |
| ------------------------------------------------- | -------------------------------------------------------------------------- |
| `select(address, extend = false)`                 | Update selection; does not scroll                                          |
| `selectAxis(axis, index, extend?)`, `selectAll()` | Select rows, columns or the sheet                                          |
| `beginEdit(address?, initial?, editor?)`          | Start a cell or formula-bar draft                                          |
| `setDraft(text)`, `cancelEdit()`                  | Update or cancel the shared draft                                          |
| `edit(patches)`                                   | `Promise<void>`; one undoable transaction of `{ row, col, input }` patches |
| `setColumnFormula(col, formula)`                  | `Promise<void>`; set a row-zero template or clear with `null`              |
| `copy()`                                          | TSV string; requires a loaded, bounded selection                           |
| `getClipboardToken()`                             | Token for the most recent internal copy                                    |
| `paste(text, options?)`                           | `Promise<void>`; paste at the active cell                                  |
| `fill(target, source?)`                           | `Promise<void>`; extend source (default current selection) along one axis  |
| `clearSelection()`                                | `Promise<void>`; clear editable selected cells                             |
| `undo()`, `redo()`                                | `Promise<void>`; reverse/reapply a local transaction                       |
| `parseInput(text, address?)`                      | Typed `CellInput` for a column                                             |
| `setError(error)`, `clearError()`                 | Application-visible operation errors                                       |

`CellInput` is `string | number | boolean | null`. A string beginning with `=` is a formula; a leading apostrophe escapes literal text. Mutations can reject for read-only cells, invalid types, stale revisions, disconnection or capacity limits. A transaction is limited to 10,000 cells. Catch rejections; do not report a successful save just because a draft changed.

`PasteOptions` contains `mode: 'all' | 'values' | 'formulas'`, `transpose` and `useInternalFormulas`. Defaults are `all`, `false` and `true`. For browser clipboard events, enable internal formulas only when the `CLIPBOARD_MIME` token matches `getClipboardToken()`; explicitly pass `false` for untrusted external text. The legacy boolean second argument is still supported.

## View configuration

`configure(settings)` applies undoable `ViewSettings`: `name`, `frozen`, `query`, `columnOptions` and `conditionalRules`. Each supplied field replaces that settings field; omitted fields remain unchanged. Settings reference canonical columns.

`changeView(change)` accepts these operations with visible axis positions:

```ts
type ViewChange =
  | { type: 'move'; axis: 'rows' | 'columns'; start: number; count: number; before: number }
  | { type: 'hide' | 'remove'; axis: 'rows' | 'columns'; start: number; count: number }
  | { type: 'showAll'; axis: 'rows' | 'columns' }
  | { type: 'resize'; axis: 'rows' | 'columns'; start: number; count: number; size: number }
  | { type: 'insert'; axis: 'rows' | 'columns'; before: number; label?: string };
```

Source items can be hidden; removal applies to owned custom items. Row structure changes reject while a query is active. `setViewState(next)` replaces the current view state without recording a user transaction; use it for controlled state restoration, not normal toolbar actions. See [views](../views.md) for persistence and formula remapping.
