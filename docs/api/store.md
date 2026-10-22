# Store and coordinates

```ts
import { createSpreadsheet, type SpreadsheetStore } from '@sheet/core';
```

`createSpreadsheet(options)` returns a `SpreadsheetStore`. The store owns its source and the optional view wrapper. Call `dispose()` when the host no longer needs it.

## Options

| Option                       | Default  | Purpose                                                 |
| ---------------------------- | -------- | ------------------------------------------------------- |
| `source: DataSource`         | Required | Authoritative data and mutation contract                |
| `view: { state, onChange? }` | None     | Enable view layout, filtering, formatting and overrides |
| `blockRows`                  | `64`     | Cache block row count                                   |
| `blockColumns`               | `8`      | Cache block column count                                |
| `maxBlocks`                  | `48`     | Maximum retained blocks                                 |
| `historyLimit`               | `100`    | Maximum undo transactions                               |

`view.state` is the initial `SheetViewState`; `view.onChange(state)` notifies the host when the view changes. With `view`, `source` must be a `ViewCapableSource`: a source with the `views` capability (check with `hasViews(source)`). The type of `createSpreadsheet`'s options enforces this.

```ts
import { createSpreadsheet, createViewState, hasViews } from '@sheet/core';

const store = hasViews(source)
  ? createSpreadsheet({
      source,
      view: { state: createViewState(source, { viewId: 'default', sourceId: 'orders' }) },
    })
  : createSpreadsheet({ source });
```

## Coordinate systems

`Address` is `{ row: RowIndex, col: ColIndex }`; indexes start at zero and are branded per axis and coordinate space. Construct addresses with `Address.of(row, col)` (validated) or `Address.unsafe(row, col)`. `CellRange` is `{ start, end }`; both endpoints are inclusive.

| Space     | Meaning                                                         | Examples                                                 |
| --------- | --------------------------------------------------------------- | -------------------------------------------------------- |
| Visible   | Current displayed positions after hiding/query projection       | `select`, `readCell`, `edit`, `props.cell`               |
| Logical   | View order including hidden rows/columns; used by A1 references | `logicalAddress`, `labelAddress`                         |
| Canonical | Stable source identity, unchanged by view order                 | View input keys, formats, query columns, label callbacks |

Use `store.resolveAddress('B12')` to turn an A1 label into a visible address; it returns `null` if it cannot resolve to a visible cell. `store.logicalAddress(address)` returns the `LogicalAddress` and `store.labelAddress(address)` its A1 label. `store.isInside(address)` checks that an address is within the current dimensions. Do not derive labels from a virtual row index when a query or hidden items are active. See [coordinates](../guides/coordinates.md) for the branded types and all conversions.

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

| Method                                            | Result / behavior                                                         |
| ------------------------------------------------- | ------------------------------------------------------------------------- |
| `select(address, extend = false)`                 | Update selection; does not scroll                                         |
| `selectAxis(axis, index, extend?)`, `selectAll()` | Select rows, columns or the sheet; `index` is `AxisIndex<axis>`           |
| `beginEdit(address?, initial?, editor?)`          | Start a cell or formula-bar draft                                         |
| `setDraft(text)`, `cancelEdit()`                  | Update or cancel the shared draft                                         |
| `commitDraft(text?, address?)`                    | `Promise<'committed' \| 'unchanged'>`; parse and write a draft            |
| `edit(patches)`                                   | `Promise<void>`; one undoable transaction of `CellPatch` records          |
| `setColumnFormula(col, formula)`                  | `Promise<void>`; set a row-zero `Formula` template or clear with `null`   |
| `copy()`                                          | TSV string; requires a loaded, bounded selection                          |
| `getClipboardToken()`                             | Token for the most recent internal copy                                   |
| `paste(text, options?)`                           | `Promise<void>`; paste at the active cell                                 |
| `fill(target, source?)`                           | `Promise<void>`; extend source (default current selection) along one axis |
| `clearSelection()`                                | `Promise<void>`; clear editable selected cells                            |
| `undo()`, `redo()`                                | `Promise<void>`; reverse/reapply a local transaction                      |
| `parseInput(text, address?)`                      | Typed `CellInput` for a column                                            |
| `columnOptions(col)`                              | `ColumnOptions` of a visible column, if a view configures one             |
| `setError(error)`, `clearError()`                 | Application-visible operation errors                                      |

A `CellPatch` is an address plus `input`, for example `{ ...Address.of(0, 1), input: '=A1*2' }`. `CellInput` is `string | number | boolean | null`. A string beginning with `=` is a formula (`Formula` is the template type `` `=${string}` ``; narrow with `isFormula`); a leading apostrophe escapes literal text. Mutations can reject for read-only cells, invalid types, stale revisions, disconnection or capacity limits. A transaction is limited to 10,000 cells. Rejections are `SheetError`s with a `code` (see [errors](adapters.md#errors)). Catch rejections; do not report a successful save just because a draft changed.

`commitDraft` defaults to the current draft and the editing (or active) cell. It resolves `'unchanged'` and cancels the edit when the text equals the current input. Otherwise it parses the text by the column type and writes it; on a remote source without a view, it writes a calculated-column template instead. The React hook's `edit.commit()` wraps it with error reporting and focus handling.

`PasteOptions` contains `mode: 'all' | 'values' | 'formulas'`, `transpose` and `useInternalFormulas`. Defaults are `all`, `false` and `true`. For browser clipboard events, enable internal formulas only when the `CLIPBOARD_MIME` token matches `getClipboardToken()`; explicitly pass `false` for untrusted external text. The legacy boolean second argument is still supported.

## View configuration

`configure(settings)` applies undoable `ViewSettings`: `name`, `frozen`, `query`, `columnOptions` and `conditionalRules`. Each supplied field replaces that settings field; omitted fields remain unchanged. Settings reference canonical columns: filters, sorts and rules take a `CanonicalCol`, and `columnOptions` is keyed by canonical column number.

`changeView(change)` accepts these operations with visible axis positions:

```ts
// X is 'rows' or 'columns'; AxisIndex<'rows'> is RowIndex and AxisIndex<'columns'> is ColIndex.
type AxisChange<X extends Axis> =
  | { type: 'move'; axis: X; start: AxisIndex<X>; count: number; before: AxisIndex<X> }
  | { type: 'hide' | 'remove'; axis: X; start: AxisIndex<X>; count: number }
  | { type: 'showAll'; axis: X }
  | { type: 'resize'; axis: X; start: AxisIndex<X>; count: number; size: number }
  | { type: 'insert'; axis: X; before: AxisIndex<X>; label?: string };
type ViewChange = AxisChange<'rows'> | AxisChange<'columns'>;
```

Source items can be hidden; removal applies to owned custom items. Row structure changes reject while a query is active. `setViewState(next)` replaces the current view state without recording a user transaction; use it for controlled state restoration, not normal toolbar actions. See [views](../views.md) for persistence and formula remapping.
