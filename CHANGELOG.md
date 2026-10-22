# Changelog

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
