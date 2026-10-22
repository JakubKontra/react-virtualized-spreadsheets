# Your own design system

Use the headless packages when a spreadsheet should match an existing application shell, proprietary component library or specialized workflow.

Start from the [headless renderer guide](../guides/headless.md). Keep `@sheet/core`, `@sheet/react` and your chosen transport. Supply DOM, styling, headers, toolbars, error messages and editing overlays yourself.

The hook gives you geometry and interaction handlers. Your components still decide how selected cells look, where formula assistance appears and how menus return focus. Keep virtual cells small and subscribe through `useCell`; create menus or rich controls only where needed.

If you only need different colors, labels or extra actions, the existing [UI renderer](../ui.md) may be sufficient. It accepts canonical column labels, widths, per-instance classes and `renderToolbar`. Its portal container inherits instance theme tokens.

For a specialized renderer, test keyboard editing, range selection, clipboard, hidden/query-projected coordinates, frozen geometry and focus after virtual scrolling. These are interactions a static table does not cover automatically.
