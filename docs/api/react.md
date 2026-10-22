# React hooks

All hooks are exported from `@sheet/react`. They require a host-owned store and must run in a client React tree.

## useSpreadsheet(options)

| Option                                       | Default       | Meaning                                       |
| -------------------------------------------- | ------------- | --------------------------------------------- |
| `store: SpreadsheetStore`                    | Required      | Store for this grid                           |
| `scrollRef: RefObject<HTMLElement \| null>`  | Required      | Scrolling grid element                        |
| `rowHeight: number`                          | `32`          | Default row height in pixels                  |
| `columnWidth: (col: CanonicalCol) => number` | Returns `120` | Width callback using canonical column indexes |
| `rowHeaderWidth: number`                     | `52`          | Space reserved for row headers                |
| `columnHeaderHeight: number`                 | `34`          | Space reserved for column headers             |

The hook subscribes to store state and updates bounded viewport requests. It returns a `SpreadsheetController`, grouped by concern:

| Member                                         | Use                                                                              |
| ---------------------------------------------- | -------------------------------------------------------------------------------- |
| `state`, `selection`                           | Current `SpreadsheetState` snapshot and normalized selection `CellRange`         |
| `layout.virtualRows`, `.virtualColumns`        | `VirtualRow` / `VirtualColumn` items with `key`, `index`, `start`, `size`, `end` |
| `layout.totalHeight`, `.totalWidth`            | Scroll-space dimensions                                                          |
| `layout.frozenRows`, `.frozenColumns`          | Pinned counts that fit the viewport (counts, not indices)                        |
| `layout.displayRow(index, start)`              | Rendered row offset adjusted for pinned rows; `displayColumn` for columns        |
| `layout.cellRect(address)`                     | `CellRect` `{ left, top, width, height }` for an overlay or editor               |
| `edit.draft`, `edit.setDraft(text)`            | Shared editing text                                                              |
| `edit.start({ initial?, address? })`           | Start a draft; defaults to the active cell. `initial` replaces the content       |
| `edit.commit({ text?, move?, restoreFocus? })` | `Promise<boolean>`; `false` reports the error and retains the draft              |
| `edit.cancel()`                                | Discard the draft                                                                |
| `navigation.select(address, { extend? })`      | Commit any draft, select and scroll                                              |
| `navigation.scrollToCell(address)`             | Scroll to a visible grid coordinate                                              |
| `props.grid`                                   | Grid accessibility, keyboard and clipboard handlers                              |
| `props.cell(address)`                          | Cell identity, ARIA state, pointer/double-click handlers and highlight styles    |
| `props.editor`, `props.formulaBar`             | Synchronized inputs, draft tracking and commit/cancel handlers                   |
| `props.fillHandle`, `fillPreview`              | Autofill handle props and the range the current drag covers                      |
| `gestures`                                     | Header/resize/drag props, drag preview, header menu and live announcement        |
| `formula`                                      | Suggestions, function help, colored references and reference picking             |
| `summary`                                      | `SelectionSummaryState` for the current selection                                |

`move` is `'down' | 'left' | 'right' | 'none'` (default `'none'`); `restoreFocus` defaults to `true`.

Addresses passed to the hook are zero-based **visible** coordinates; virtual item indices are already branded `RowIndex` / `ColIndex`. A1 labels are logical addresses; resolve them through the store when rows are hidden or filtered. See [coordinates](../guides/coordinates.md). Invalid addresses throw. Keep error handling around host actions that mutate data.

### gestures

`SheetGestures` members take an axis and an index of that axis: `headerProps(axis, index)`, `dragProps(axis, index)`, `resizeProps(axis, index)`, `selection(axis, index)` and `openMenu(axis, index, x, y)`. `index` is `AxisIndex<axis>`: a `RowIndex` for `'rows'` and a `ColIndex` for `'columns'`. `preview` is a `DragPreview` or `null`; `menu` is a `HeaderMenu` (discriminated by `axis`) or `null`; `closeMenu()` dismisses it. `run(change)` commits a pending edit, applies a `ViewChange` and resolves `false` after reporting a failure on the store. `startSelection(event)` begins a pointer selection.

### formula

`FormulaEditorController` exposes `suggestions`, `selected`, `accept(index?)`, `help` (`FunctionHelp | null` with the 1-based `argument`), `diagnostics` and `references`. Each `FormulaReference` has a `LogicalAddress` `start` / `end` and a color. `referenceColor(address)`, `toggleAbsoluteReference()`, `track(event)`, `onKeyDown(event)` and `pick()` wire your own input and listbox.

### summary

`summary` is a union discriminated by `status`:

```ts
type SelectionSummaryState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; value: SelectionSummary }
  | { status: 'error'; error: string };
```

It stays `idle` when the source has no `summary` capability, the sheet is empty or a query is running.

## useCell(store, address)

Returns a stable `CellSnapshot` and subscribes only to that visible cell. The snapshot contains `input`, `value`, `status` and an optional `message`. Status is `loading`, `calculating`, `ready` or `error`. Render unloaded values as loading, not zero. Use `isError(value)` from `@sheet/core` to recognize formula errors. The subscription follows the address's coordinates, not its object identity.

## useSpreadsheetState(store)

Returns the store's `SpreadsheetState` through `useSyncExternalStore`. Use this for toolbar state, pending edits, connection status and errors. Avoid subscribing every cell to this broader snapshot.

## useSelectionSummary(store, options)

`options` is `UseSelectionSummaryOptions`: `{ range, revision, enabled? }`. `revision` is the data `Revision` (for example `state.revision`) and `enabled` defaults to `true`. Returns a `SelectionSummaryState`. It debounces requests by 200 ms, aborts outdated requests and uses the source's `summary` capability. The main hook already uses it for the active selection.

## Exported types

`SpreadsheetController`, `UseSpreadsheetOptions`, `GridLayout`, `EditSession`, `Navigation`, `PropGetters`, `GridProps`, `CellProps`, `EditorProps`, `FillHandleProps`, `VirtualRow`, `VirtualColumn`, `VirtualAxisItem`, `CellRect`, `StartEditOptions`, `CommitEditOptions`, `CommitMove`, `SelectionSummaryState`, `FormulaEditorController`, `FunctionHelp`, `ReferencePick`, `FormulaReference`, `ReferenceColor`, `SheetGestures`, `HeaderMenu`, `DragPreview`, `DropLine` and `AxisSelection`. `REFERENCE_COLORS` is the palette used for formula references.

## Low-level hooks

`useSpreadsheet` composes these hooks. Use them to build a narrower controller.

| Export                                      | Purpose                                                                                      |
| ------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `useGridLayout(options)`                    | Virtualization and geometry (`GridGeometry`): the `layout` group plus scroll and hit-testing |
| `useEditSession(options)`                   | The `edit` and `navigation` groups over a store (`EditSessionHandle`)                        |
| `useSheetGestures(options)`                 | Header selection, move, resize and menu state                                                |
| `useRangeDrag(options)`                     | Pointer range drags with edge auto-scroll for autofill and formula reference picking         |
| `useFormulaEditor(store, draft, editing)`   | The `formula` controller for a draft                                                         |
| `useStableCallback(fn)`, `useLatest(value)` | Stable callback identity and a ref to the latest value                                       |
| `resolveGridKey(input, context)`            | Pure keyboard resolver mapping a key to a `GridCommand`                                      |

These hooks are lower-level building blocks; their options follow the source in `packages/react/src/hooks` and may change more often than `useSpreadsheet`.

See the [headless guide](../guides/headless.mdx) for a minimal renderer and [lifecycle guide](../guides/lifecycle.md) for cleanup.
