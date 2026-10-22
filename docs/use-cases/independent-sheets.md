# Multiple independent sheets

Render more than one spreadsheet in a dashboard, comparison view or side-by-side editor. Create a separate store and source for each independent dataset. The [live example](../examples/independent.mdx) uses two stores with different inputs.

Each instance owns its selection, draft, history and portal target. Sharing a store intentionally shares state; do not share it when edits and selection must remain independent.

## Lifecycle and persistence

The host creates both stores and disposes both on unmount. Temporarily hiding a renderer does not dispose its store, so a host can remount it without losing in-memory edits. For persistent views, give each distinct view a unique `viewId`; reusing an ID makes adapters address the same saved definition.

Set `className` to give an instance its own shadcn tokens. Menus and dialogs inherit that scope, and editor IDs remain unique. Verify focus returns to the instance that opened a dialog.

## Workbook boundaries

These are independent spreadsheet instances, not a workbook with cross-sheet formulas. References such as `Sheet2!A1` are not supported. Build application-level coordination explicitly if one sheet must react to another, and keep that behavior separate from formula semantics. Multi-sheet references remain on the [roadmap](../roadmap.md).
