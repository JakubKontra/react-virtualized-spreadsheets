# Overview

**react-virtualized-spreadsheets** is a TypeScript spreadsheet toolkit for React. It combines two-axis virtualization, an Excel-style formula subset, editable views and interchangeable calculation backends.

Use the optional shadcn/ui renderer for a complete spreadsheet interface, or use the headless hooks to build your own. The application owns the store, its data and its lifecycle.

## Pick your starting point

| You need                                           | Start here                                                           |
| -------------------------------------------------- | -------------------------------------------------------------------- |
| A working grid with menus and formula editing      | [First spreadsheet](first-sheet.mdx) and [shadcn/ui guide](../ui.md) |
| Your own components and design system              | [Headless rendering](../guides/headless.md)                          |
| Calculations over a large local dataset            | [Worker data source](../guides/data-sources.md#local-worker)         |
| Authoritative server calculations and live updates | [Server reporting recipe](../use-cases/server-reporting.md)          |
| Something to try before integrating                | [Interactive examples](../examples/basic.mdx)                        |

## Architecture

```text
Your React application
  ├─ @sheet/ui (optional renderer)
  └─ @sheet/react (virtualization + interaction hooks)
           │
       @sheet/core (store, views, history, formula engine)
           │
       DataSource
           ├─ local calculation worker
           └─ HTTP + server-sent events
```

| Package            | Responsibility                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| `@sheet/core`      | Formula evaluation, sparse inputs, block cache, transactions, selection, view state and history |
| `@sheet/react`     | Virtual geometry, cell subscriptions, editing, clipboard, range and header gestures             |
| `@sheet/ui`        | Optional shadcn/ui renderer, scoped theme tokens, toolbar, menus and dialogs                    |
| `@sheet/transport` | Worker RPC, local/HTTP sources and localStorage/HTTP view persistence                           |

Virtualization bounds rendered cells; the block cache bounds browser data. Calculations still use the complete source, including records that have never been visible. A paginated source must calculate formulas on the server instead of returning blanks for unloaded records.

## Project status

The packages are version `0.1.0` workspace packages and **are not published to npm**. APIs can change before a stable release. The headless React package supports React 18+; the UI package needs React 19+ and Tailwind CSS 4. See [installation](installation.md) for workspace and tarball use.

Available now: editing and history, relative/absolute formula references, autofill, clipboard modes, frozen panes, sorting, filtering, typed columns, conditional formatting, view layout changes and persistence. See the [roadmap](../roadmap.md) for the next priorities.

This is an Excel-style subset. XLSX import/export, merged cells, charts, cross-sheet references and real-time collaborative editing are not implemented. The [formula reference](../formulas.md) and [performance notes](../performance.md) describe the actual boundaries.
