# shadcn/ui renderer

`@sheet/ui` is an optional React 19 renderer built with shadcn/ui **base-nova**, Base UI and Lucide. It includes the virtual spreadsheet, formula editor and assistance, header actions, autofill, formatting, filters, saved views and clipboard tools. `@sheet/core`, `@sheet/react` and `@sheet/transport` remain independent of the UI kit.

The consumer owns Tailwind CSS 4. The package ships source CSS and the component sources required for Tailwind's scanner; it does not ship a global reset, font or body theme. Its default palette is neutral and light. Settings load in a separate JavaScript chunk when opened. The grid, headers and cell editor keep their existing geometry and lightweight DOM.

## Install in this workspace

The packages have not been published to npm. Add `@sheet/ui` and `@sheet/core` as `workspace:*` dependencies, and `@sheet/transport` when using its adapters. Build the workspace packages before consuming their exports:

```sh
pnpm install
pnpm build
pnpm dev:ui-example
```

The independent example at **http://127.0.0.1:5174** has two inventories, custom labels, a toolbar action, per-instance theming and no persistence. It intentionally imports built package exports without Vite source aliases. The demo at port 5173 uses source aliases for fast development.

For a separate repository, pack the packages with `pnpm pack` and install the resulting archives. The `test:ui-package` check exercises this path without publishing anything.

## Consumer setup

For Vite, install `tailwindcss` and `@tailwindcss/vite` and register the plugin alongside React:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({ plugins: [react(), tailwindcss()] });
```

Import these once in the application's CSS:

```css
@import 'tailwindcss';
@import '@sheet/ui/styles.css';
```

The second import includes an explicit `@source` for the shipped UI components, including components rendered through a portal and the deferred settings chunk. Consumers do not need to scan the workspace's source paths. Tailwind's reset comes from the application's first import.

```tsx
import { Spreadsheet, Button } from '@sheet/ui';
import { Address, type CanonicalCol, type SpreadsheetStore } from '@sheet/core';

const labels = ['Item', 'Quantity', 'Cost'];
const getColumnLabel = (column: CanonicalCol) => labels[column];
const columnWidth = (column: CanonicalCol) => (column === 0 ? 220 : 140);

export function Inventory({ store }: { store: SpreadsheetStore }) {
  return (
    <Spreadsheet
      store={store}
      title="Inventory"
      height={480}
      locale="cs-CZ"
      getColumnLabel={getColumnLabel}
      columnWidth={columnWidth}
      renderToolbar={(sheet) => (
        <Button variant="outline" onClick={() => sheet.navigation.select(Address.of(0, 0))}>
          First item
        </Button>
      )}
    />
  );
}
```

Create and dispose the store in the host application. Changing the renderer or unmounting one spreadsheet does not dispose its store or persistence binding. In React Strict Mode, each effect setup must create fresh instances after the previous cleanup. See [the runnable example](examples/independent.mdx) and `apps/ui-example/src/main.tsx`.

## Props and optional integrations

| Prop                              | Behavior                                                                                                                                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `store`                           | Required `SpreadsheetStore`. Supplies all data and interaction state.                                                                                                                                  |
| `title`                           | Defaults to the view name, then `Spreadsheet`. Also labels the workbook region.                                                                                                                        |
| `height`                          | Grid scroll viewport height; defaults to `480` pixels. Accepts CSS lengths such as `60vh`.                                                                                                             |
| `locale`                          | Number and value formatting; defaults to `en-US`. Interface labels remain English.                                                                                                                     |
| `className`                       | Applied to the instance root, including its portal container.                                                                                                                                          |
| `getColumnLabel(canonicalColumn)` | Optional label fallback after view-owned labels. Receives stable canonical indexes, including after reordering. No sales-specific labels are supplied by the library.                                  |
| `columnWidth(canonicalColumn)`    | Same semantics as `useSpreadsheet`. Default 120px; saved view widths take precedence. Keep the callback stable.                                                                                        |
| `renderToolbar(sheet)`            | Adds application actions after Undo/Redo. Receives the headless controller, including `edit.commit`, `edit.start` and `navigation.select`. Commit any draft before mutating data.                      |
| `persistence`                     | Optional structural binding with `subscribe`, `getSnapshot` and `flush`. Compatible with `ViewPersistenceBinding`. Without it, save indicators and page-unload handling are absent.                    |
| `views`                           | Optional adapter exposing `list` and `save`. Compatible with `LocalStorageViewAdapter` and `HttpViewAdapter`; the UI never constructs an adapter or accesses localStorage.                             |
| `onSwitchView(id)`                | Host callback receiving a `ViewId` that loads and mounts the selected view's store. Named-view controls appear only with a view-enabled store, persistence, an adapter with `list`, and this callback. |

`getSnapshot` must return a stable `SpreadsheetSaveStatus` object until it changes: `{ status: 'saved' | 'saving' | 'unsaved', error: null }` or `{ status: 'error', error: string }`. Subscription/getter methods should be bound to their owner (the built-in binding already uses arrow methods). `flush` returns a promise. Save errors remain visible and can be retried.

A plain store supports editing, formulas, selection, clipboard and history. Freeze, sort/filter, formatting and structural controls appear only when `store.view` exists. Values use `store.columnOptions`; numeric columns do not imply a currency. See [view configuration](views.md) to enable these features.

Each instance uses unique editor/list IDs and its own portal target. Formula help stays next to the active editor; settings and header actions return focus to the originating instance. Multiple instances need distinct stores to keep selections and edits independent.

## Theme and shadcn customization

The grid's `--sheet-*` variables read standard shadcn tokens with neutral fallbacks. Set standard tokens on an ancestor or the instance class; dialogs, header menus, tooltips and formula help inherit the same values:

```css
.inventory-theme {
  --background: #fffbeb;
  --foreground: #292524;
  --popover: #fff7d6;
  --popover-foreground: #292524;
  --muted: #fef3c7;
  --border: #fde68a;
  --primary: #78350f;
  --primary-foreground: #fff;
  --selection: #fde68a;
}
```

`--selection` is the spreadsheet selection fill. For a dark theme, provide a complete dark token set, including selection, and use your application's `.dark` class. The package does not change the application's color mode.

`packages/ui/components.json` and `apps/demo/components.json` use the same `base-nova` preset, neutral base and Lucide icons, following the [official monorepo setup](https://ui.shadcn.com/docs/monorepo). Component sources live in `packages/ui/src/components`. Local changes add per-instance portal targets; preserve those when refreshing registry components. The source subpaths `@sheet/ui/components/*` are available for bundlers that transpile TSX; `Spreadsheet` and `Button` also have compiled exports at `@sheet/ui`.

## Checks

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm test:ui-package
pnpm benchmark:browser
```

The package check creates archives, installs them in a temporary application, builds production assets, and opens the result in Chromium to check Tailwind styling, dialogs and editing. The temporary application is removed afterwards. Browser checks also cover two independent stores, locale and custom labels, absence of persistence/view controls, portal theme inheritance, unique IDs, keyboard focus return and remounting a host-owned store.
