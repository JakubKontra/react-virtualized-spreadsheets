# React hooks

All hooks are exported from `@sheet/react`. They require a host-owned store and must run in a client React tree.

## useSpreadsheet(options)

| Option                                      | Default       | Meaning                                       |
| ------------------------------------------- | ------------- | --------------------------------------------- |
| `store: SpreadsheetStore`                   | Required      | Store for this grid                           |
| `scrollRef: RefObject<HTMLElement \| null>` | Required      | Scrolling grid element                        |
| `rowHeight: number`                         | `32`          | Default row height in pixels                  |
| `columnWidth: (col: number) => number`      | Returns `120` | Width callback using canonical column indexes |
| `rowHeaderWidth: number`                    | `52`          | Space reserved for row headers                |
| `columnHeaderHeight: number`                | `34`          | Space reserved for column headers             |

The hook subscribes to store state and updates bounded viewport requests. Its return value includes:

| Return member                                             | Use                                                              |
| --------------------------------------------------------- | ---------------------------------------------------------------- |
| `state`, `selection`                                      | Current snapshot and normalized selection                        |
| `virtualRows`, `virtualColumns`                           | Virtual items with `key`, `index`, `start`, `size`               |
| `totalHeight`, `totalWidth`                               | Scroll-space dimensions                                          |
| `gridProps`                                               | Grid accessibility, keyboard and clipboard handlers              |
| `getCellProps(address)`                                   | Cell identity, ARIA state, pointer and double-click handlers     |
| `editorProps`, `formulaBarProps`                          | Synchronized inputs, draft tracking and commit/cancel handlers   |
| `draft`, `setDraft(text)`                                 | Shared editing text                                              |
| `startEdit(initial?, address?)`                           | Start a draft; defaults to the active cell                       |
| `commitEdit(text?, move?, restoreFocus?)`                 | `Promise<boolean>`; reports errors and retains a failed draft    |
| `select(address, extend?)`                                | Commit any draft, select and scroll                              |
| `scrollToCell(address)`                                   | Scroll to a visible grid coordinate                              |
| `cellRect(address)`                                       | `{ left, top, width, height }` for an overlay/editor             |
| `frozenRows`, `frozenColumns`                             | Pinned counts that fit the viewport                              |
| `displayRow(index, start)`, `displayColumn(index, start)` | Positions adjusted for pinned items                              |
| `gestures`                                                | Header/resize/drag props and preview geometry                    |
| `fillHandleProps`, `fillPreview`                          | Autofill interaction and target preview                          |
| `formula`                                                 | Suggestions, reference picking and formula assistance controller |
| `summary`                                                 | Selection summary value, loading state and error                 |

Addresses passed to the hook are zero-based **visible** coordinates. A1 labels are logical addresses; resolve them through the store when rows are hidden or filtered. Invalid addresses throw. Keep error handling around host actions that mutate data.

## useCell(store, row, col)

Returns a stable `CellSnapshot` and subscribes only to that visible cell. The snapshot contains `input`, `value`, `status` and an optional `message`. Status is `loading`, `calculating`, `ready` or `error`. Render unloaded values as loading, not zero. Use `isError(value)` from `@sheet/core` to recognize formula errors.

## useSpreadsheetState(store)

Returns the store's `SpreadsheetState` through `useSyncExternalStore`. Use this for toolbar state, pending edits, connection status and errors. Avoid subscribing every cell to this broader snapshot.

## useSelectionSummary(store, range, revision, querying?)

Returns `{ value, loading, error }`. It debounces requests by 200 ms, aborts outdated requests and uses the source's `getSummary` capability. `value` is a `SelectionSummary` or `null`; unsupported summaries remain empty. The main hook already uses it for the active selection.

See the [headless guide](../guides/headless.md) for a minimal renderer and [lifecycle guide](../guides/lifecycle.md) for cleanup.
