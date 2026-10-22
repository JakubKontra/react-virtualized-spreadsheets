# Store lifecycle and errors

Create a store for each independent workbook. The application owns it; mounting or unmounting `<Spreadsheet>` never disposes its store. A store owns its source, so `store.dispose()` also disposes the source and terminates its worker or closes its event stream.

## React Strict Mode

Create fresh resources in an effect setup and dispose those exact resources in its cleanup. Do not create a singleton store at module scope and dispose it from an effect: Strict Mode's setup/cleanup/setup cycle would reuse a disposed instance.

The [first spreadsheet](../getting-started/first-sheet.mdx#3-own-the-store-lifecycle) includes a working helper. Keep its factory at module scope; changing the factory identity recreates the stores.

## Async sources

Abort a pending connection when the host unmounts. Also dispose a source if it finishes connecting after cancellation:

```tsx
useEffect(() => {
  const controller = new AbortController();
  let current: SpreadsheetStore | undefined;
  void createHttpSource({ baseUrl: '/api/sheet', signal: controller.signal })
    .then((source) => {
      if (controller.signal.aborted) {
        source.dispose();
        return;
      }
      current = createSpreadsheet({ source });
      setStore(current);
    })
    .catch((error) => {
      if (!controller.signal.aborted) setError(String(error));
    });
  return () => {
    controller.abort();
    current?.dispose();
  };
}, []);
```

Here `createSpreadsheet` and `SpreadsheetStore` come from `@sheet/core`; `createHttpSource` comes from `@sheet/transport`. `setStore` and `setError` are host React state setters.

## Operations and failure states

Await `edit`, `paste`, `fill`, `clearSelection`, `undo` and `redo`. Catch rejections and show them in your application's error surface, or call `store.setError(error)` to use the renderer's error display. Rejections are `SheetError`s; branch on `error.code` (for example `REVISION_CONFLICT` or `DISCONNECTED`) rather than on the message. Formula evaluation errors are cell values with an error code; they are distinct from rejected mutations or network failures. See [errors](../api/adapters.md#errors).

`useSpreadsheet().edit.commit()` returns `Promise<boolean>`. A rejected mutation returns `false`, retains the draft and exposes the error. Without React, `store.commitDraft()` rejects instead. A disconnected remote source rejects writes. Do not clear a draft or report success until an operation succeeds.

## Persistence cleanup

The host owns `ViewPersistenceBinding` separately. Before an explicit view switch, `await binding.flush()` and inspect `binding.getSnapshot()`: `flush()` records save failures in its status instead of rejecting. Keep the current view open when saving fails.

Dispose the binding before the store. Disposal aborts saves; it does not guarantee a final save. Browser unload cannot reliably await asynchronous writes, so surface saving/unsaved/error status during normal use. See [view persistence](../views.md).
