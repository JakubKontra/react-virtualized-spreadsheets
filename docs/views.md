# View state, interactions and persistence

A view owns layout and calculations over an immutable source identity space. Moving, hiding or removing a custom item never deletes source records. The same view contract works over a local worker and an HTTP calculation service.

## Create and control a view

```ts
import { createSpreadsheet, createViewState } from '@sheet/core';
import { LocalStorageViewAdapter, ViewPersistenceBinding } from '@sheet/transport';

const controller = new AbortController();
const adapter = new LocalStorageViewAdapter(localStorage);
const saved = await adapter.load('my-sales-view', controller.signal);
const viewState =
  saved?.state ??
  createViewState(source, {
    viewId: 'my-sales-view',
    sourceId: 'sales-v1',
    // Optional: designate existing calculated/blank columns as custom.
    ownedColumns: [6, 7, 8],
    labels: { 6: 'Revenue', 7: 'Margin', 8: 'Calculation' },
  });
const store = createSpreadsheet({
  source,
  viewState,
  onViewStateChange: (next) => {
    /* Optional external state subscription. */
  },
});
const persistence = new ViewPersistenceBinding(store.view!, adapter, saved?.version ?? null);

store.changeView({ type: 'move', axis: 'rows', start: 5, count: 2, before: 12 });
store.changeView({ type: 'insert', axis: 'columns', before: 8, label: 'Forecast' });
store.changeView({ type: 'hide', axis: 'rows', start: 20, count: 100 });
store.changeView({ type: 'showAll', axis: 'rows' });
store.changeView({ type: 'resize', axis: 'columns', start: 0, count: 1, size: 180 });
// Only custom items can be removed:
store.changeView({ type: 'remove', axis: 'columns', start: 8, count: 1 });

await persistence.flush(); // Before changing workbook/routes.
persistence.dispose(); // Abort pending IO and unsubscribe.
store.dispose();
```

Supply a complete source with `getViewBlocks(view, ranges, signal)`. The worker adapter and HTTP adapter implement it. A custom calculator can use `ViewCalculationRegistry` over its complete source engine. Views never fall back to sums over cached browser blocks.

`viewState` initializes the store. For external state control, observe `onViewStateChange` and apply a replacement with `store.setViewState(next)` only when external content changes; do not feed every emitted state straight back into the store. Replacement requires the same view/source identity and dimensions. It invalidates blocks and is not an undoable user action. User commands belong in `changeView`, `edit` and `setColumnFormula`.

## Coordinates and identities

| Coordinate | Meaning                                                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Visible    | Dense zero-based positions consumed by the store, virtualizers and interaction commands. Hidden items are excluded.                   |
| Logical    | Current order including hidden items; used by A1 labels and the formula bar.                                                          |
| Canonical  | Stable original source index or monotonically allocated custom index. Used inside persisted inputs/formulas and calculation requests. |

`before` is an insertion boundary in the original visible order: zero means before the first item, `count` means after the last. Moving a selected block onto one of its own boundaries is a no-op. Inserting returns a new custom identity; undo/redo preserves that identity. Active-cell selection follows its identity after a move and falls back to the nearest visible position after hiding/removal.

Source IDs, ordering and dimensions must stay stable for the lifetime of a saved view. A changed source snapshot should use a new `sourceId` / `viewId`, or an application-owned migration. The renderer obtains stable IDs from `store.source.rowId()` and `columnId()`. `store.view.rows` / `.columns` expose visible, logical and canonical mapping helpers.

`SheetViewState` schema version 1 stores axis order as `{start, count}` spans, hidden spans, sparse sizes, custom UUIDs/labels, canonical cell overrides and column templates. A million untouched rows take one span. Reorder/hide operates on spans, not a materialized array of a million IDs. Changes and inputs grow the document; it does not contain the source dataset or undo history. State snapshots are immutable by contract; use commands instead of mutating returned objects.

## Headless interactions

`useSpreadsheet({ store, scrollRef, ... })` returns:

- `gestures.headerProps(axis, index)` for header selection and context actions.
- `gestures.dragProps(axis, index)` for a dedicated handle. The drag starts at 5 px, previews a snapped insertion boundary, and commits once on release. Escape, pointer cancellation or window blur cancels it.
- `gestures.resizeProps(axis, index)` for an edge handle. It exposes separator ARIA values and arrow-key resizing. Sizes clamp to 24–2000 px for rows and 48–2000 px for columns. A selected block resizes together, up to 10,000 items in one operation.
- `gestures.preview` with fixed-screen line/ghost geometry, `menu`, `openMenu`, `run`, `setMenu` and an accessible `announcement`. Render these with your own components. The demo uses a modeless action dialog so keyboard users can reach both commands and numeric inputs.

Dragging selection or a header auto-scrolls inside a 32 px viewport-edge band, capped at 24 px per animation frame. Normal scrolling stays continuous. Frozen panes use separate viewport rectangles; distant scrolling does not request the intervening cells.

Shift-click a header to extend row/column selection. Ctrl/⌘ Space selects a column; Shift Space selects a row; Shift F10 opens its actions. Ctrl/⌘ A or the corner selects all without creating cell objects. Delete clears values rather than removing structure. Use the actions dialog to insert/hide/remove.

`editorProps` and `formulaBarProps` wire the two inputs to a shared draft, with a marker that preserves focus during handoff. `state.draft`, `state.editing` and `state.editor` hold their state. `beginEdit(address, undefined, 'bar')` hands an existing draft to the formula bar; `setDraft` updates it. Commit through the hook's `commitEdit()` before structural actions. Enter/Tab/click-away commits, Escape cancels, and a rejected mutation retains the draft. The demo commits and flushes before switching data modes and warns on unload when edits remain unsaved.

## Persistence adapter

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
// PersistedView = { state: SheetViewState; version: string | null }
```

`ViewPersistenceBinding` debounces saves by 300 ms and serializes them. A change during an in-flight save queues the newer revision. Subscribe to `getSnapshot()` / `subscribe()` for `saved`, `unsaved`, `saving` or `error`. `flush()` waits for the queue and reports failures through this status; it deliberately does not reject. Check the status before navigating. Failed saves preserve the local view and can be retried with `flush()`.

`LocalStorageViewAdapter(storage, prefix?)` checks version tokens and uses Web Locks when available to coordinate cooperating tabs. Without Web Locks it has synchronous compare/write within a tab; cross-tab atomicity is not guaranteed. Storage quota, corrupt data and stale versions are surfaced, not reset silently. The demo keeps local/server views under different IDs.

`HttpViewAdapter('/api/views')` uses this contract:

| Request                                              | Response                                             |
| ---------------------------------------------------- | ---------------------------------------------------- |
| `GET /api/views/:id`                                 | `{state, version}`, or 404 for a new view            |
| `PUT /api/views/:id` with `{state, expectedVersion}` | New `{state, version}`, or 409 when another save won |

The reference server stores definitions in memory and caps request bodies at 2 MB. Its calculation registry caches up to eight isolated view engines; source revisions invalidate their cached values. Each calculation request carries the complete view definition, so it cannot accidentally use another client's template. Production hosts should persist definitions in their database, perform atomic version checks, authorize the source/view, and apply their transport limits. Authentication and shared editing are not provided by this demo.

## Queries, formatting and frozen panes

All new settings are optional schema-version-1 fields; existing saved views remain compatible. `store.configure(settings)` validates and records a single undo entry. Finish any editor draft first. Settings use **canonical column indices**, obtained with `store.view.columns.canonicalAt(visibleIndex)`.

```ts
store.configure({
  name: 'High-value sales',
  frozen: { rows: 2, columns: 1 },
  query: {
    sorts: [
      { col: 6, direction: 'desc' },
      { col: 2, direction: 'asc' },
    ],
    filters: [{ col: 6, operator: 'gte', value: 1000 }],
    search: 'Motors',
  },
  columnOptions: {
    6: { kind: 'currency', currency: 'EUR', decimals: 2 },
    9: { kind: 'select', options: ['Draft', 'Approved'] },
    10: { kind: 'checkbox' },
  },
  conditionalRules: [
    {
      id: 'loss',
      col: 6,
      operator: 'lt',
      value: 0,
      color: '#9f1239',
      background: '#ffe4e6',
      bold: true,
    },
  ],
});
```

`configure` replaces each supplied field. Merge an existing `columnOptions` object when changing just one column; likewise preserve unrelated rules when updating an array. Formats apply to columns. Numeric comparisons use raw values; text search is case-insensitive. Filters combine with AND, sorts are stable, and null/empty/error values sort last in either direction. Filter operators are `contains`, `equals`, `gt`, `gte`, `lt`, `lte`, `empty` and `notEmpty`. The first matching conditional rule wins. Rules support foreground/background colors and bold text; duplicate detection and color scales are not implemented.

Filtering hides rows from the result; logical A1 labels and references remain attached to the original view order. Formulas still evaluate against the complete source and view overlays, including filtered-out rows. Row structural commands require clearing the active query, so a dense filtered position cannot accidentally move a different source row. Column structure remains editable. An empty query result renders an empty state and can be undone or cleared. During live resorting, the active editor follows its record identity. If that record stops matching the filter, editing ends and the unsaved draft is retained in the error message so it cannot be applied to another record.

The calculation registry evaluates queries and summaries over its complete engine. Data sources expose optional `getViewRows(view, signal)` and `getViewSummary(view, selection, signal)`; worker and HTTP implementations are included. Custom adapters without those methods can still use the older layout/edit APIs. Remote contracts:

| Request                                   | Response                                                                                      |
| ----------------------------------------- | --------------------------------------------------------------------------------------------- |
| `POST /view-query` with `{view}`          | Packed canonical `Uint32` row indices, `application/octet-stream`, with `X-Sheet-Revision`    |
| `POST /view-summary` with `{view, range}` | `{count, numericCount, sum, average, min, max, revision}`; range uses visible query positions |
| `GET /views?sourceId=…`                   | `[{viewId, sourceId, name}]`                                                                  |

The query result transfers row indices, not cell records. The browser stores a packed projection and inverse index (about 8 MB combined for a million result rows). The saved view stores only query definitions. Calculations remain outside the UI thread; search/sort cost depends on the complete data and formula graph. Remote updates coalesce while a query is running. Superseded responses are discarded; an already-running synchronous worker calculation is not preempted.

### Headless rendering and editors

- `sheet.frozenRows` / `frozenColumns` report effective counts. Settings allow up to 20 rows and 10 columns, and the hook reduces these to leave scrollable space on small viewports. Use `displayRow(index, start)` / `displayColumn(index, start)` instead of raw virtual starts, and layer frozen cells above scrolling cells. Header panes need corresponding layering. The demo demonstrates these rules. `cellRect()` already includes frozen offsets.
- `sheet.fillHandleProps` wires pointer dragging and keyboard arrow extension to a handle on the selection's final cell. `fillPreview` marks the proposed range. Release commits once; Escape/pointer cancellation/blur cancels. `await store.fill(target, source?)` provides the same operation without React. A target must contain the source and extend one axis. A single number repeats; two or more linear numeric seeds extend their sequence; ISO dates extend by the seed day interval (one day for a single date); other inputs repeat. Formula references shift in logical coordinates, preserving `$` anchors. Maximum transaction: 10,000 cells, also subject to the configured cache capacity.
- `sheet.formula` exposes `suggestions`, `selected`, `accept(index)`, `help`, and colored `references`. Render a listbox with `onPointerDown={e => e.preventDefault()}` to keep editor focus. Arrow keys choose suggestions; Tab/Enter accepts; Escape dismisses. A second Escape cancels editing. `getCellProps().style` marks referenced and autofill-preview cells; merge that style with your own layout. Range picking starts where an operand is expected or replaces selected editor text.
- `sheet.summary` exposes `{value, loading, error}`. It debounces selection by 200 ms and discards stale requests. Count includes nonempty values; numeric aggregates ignore strings, booleans and errors. An all-nonnumeric selection returns `average`, `min` and `max` as null. `store.source.getSummary(range, signal)` is the lower-level entry point.
- `store.columnOptions(col)` returns the visible column's type. `store.parseInput(text, address)` handles typed input (`25%` becomes `0.25`; text preserves `0012`). `formatCellValue(value, options, locale)` and `matchesFilter(value, rule)` are exported pure helpers for custom React renderers. Types validate new writes atomically, including paste/fill. Existing values remain unchanged. Formulas are allowed through the formula bar even in typed columns.

`useCell` and the editor prop getters remain independent of markup: use your own checkbox, select, date picker or React editor. Commit the previous draft before writing through a custom editor and route writes through `store.edit` to preserve read-only checks and history. The demo provides native checkbox, date and datalist inputs. Its server calculated columns still require formula templates, regardless of display type.

### Named views

`LocalStorageViewAdapter.list(sourceId, signal)` and `HttpViewAdapter.list` return the saved catalog. Save a copy with a new `viewId` and `name`, expected version `null`, and the same source identity. A copy includes that view's input/formula overlays. To rename, configure `name` and flush the current binding. Before switching, commit the editor and flush, check the binding's status, then load the selected document into a new store/binding. The demo remembers the active view separately for local and server modes.

Local storage coordinates catalog updates and per-document versions with a shared Web Lock. The demo server catalog is in memory; supply persistent storage in a production host. Undo history stays with the mounted store and is not copied or persisted.
