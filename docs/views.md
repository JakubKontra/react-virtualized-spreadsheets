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

Dragging selection or a header auto-scrolls inside a 32 px viewport-edge band, capped at 24 px per animation frame. Normal scrolling stays continuous. There are no frozen rows/columns or animations that delay a drop.

Shift-click a header to extend row/column selection. Ctrl/⌘ Space selects a column; Shift Space selects a row; Shift F10 opens its actions. Ctrl/⌘ A or the corner selects all without creating cell objects. Delete clears values rather than removing structure. Use the actions dialog to insert/hide/remove.

`editorProps` and `formulaBarProps` wire the two inputs to a shared draft, with a marker that preserves focus during handoff. `state.draft`, `state.editing` and `state.editor` hold their state. `beginEdit(address, undefined, 'bar')` hands an existing draft to the formula bar; `setDraft` updates it. Commit through the hook's `commitEdit()` before structural actions. Enter/Tab/click-away commits, Escape cancels, and a rejected mutation retains the draft. The demo commits and flushes before switching data modes and warns on unload when edits remain unsaved.

## Persistence adapter

```ts
interface ViewPersistenceAdapter {
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
