# Spreadsheet component

```tsx
import { Spreadsheet, Button } from '@sheet/ui';
import type { SpreadsheetProps, SpreadsheetController } from '@sheet/ui';
```

`Spreadsheet` renders a workbook region around a virtual grid. It requires React 19+, Tailwind 4 and the package stylesheet. See [UI setup and theming](../ui.md) for a complete consumer configuration.

| Prop             | Type / default                                       | Contract                                                          |
| ---------------- | ---------------------------------------------------- | ----------------------------------------------------------------- |
| `store`          | `SpreadsheetStore`, required                         | Host-owned store; the component never disposes it                 |
| `title`          | `string`, view name or `Spreadsheet`                 | Visible workbook title and region label                           |
| `height`         | `CSSProperties['height']`, `480`                     | Scroll viewport height; accepts pixels or CSS lengths             |
| `locale`         | `string`, `en-US`                                    | Value formatting; interface labels remain English                 |
| `className`      | `string`                                             | Root class, including the instance portal container               |
| `getColumnLabel` | `(canonicalColumn: number) => string \| undefined`   | Label fallback after view-owned labels; stable source index       |
| `columnWidth`    | `(canonicalColumn: number) => number`, returns `120` | Initial width in pixels; saved view widths take precedence        |
| `renderToolbar`  | `(sheet: SpreadsheetController) => ReactNode`        | Additional actions after Undo/Redo; controller is the hook result |
| `persistence`    | `SpreadsheetPersistence`                             | Save-status subscription and flush operation                      |
| `views`          | `Pick<ViewPersistenceAdapter, 'list' \| 'save'>`     | Host-provided view catalog and save adapter                       |
| `onSwitchView`   | `(viewId: string) => Promise<void>`                  | Host loads and mounts the requested view                          |

`SpreadsheetController` is `ReturnType<typeof useSpreadsheet>`. The component returns React UI; use the store or controller for operations rather than a ref-based imperative API.

## Optional capabilities

A plain store supports editing, formulas, clipboard and undo/redo. Structural editing, formatting, filtering and frozen panes require `store.view`. Named-view controls require all of: a view, persistence, an adapter with `list`, and `onSwitchView`.

Persistence implements:

```ts
interface SpreadsheetPersistence {
  subscribe(listener: () => void): () => void;
  getSnapshot(): {
    status: 'saved' | 'saving' | 'unsaved' | 'error';
    error: string | null;
  };
  flush(): Promise<void>;
}
```

Return a stable snapshot until status changes. Bind methods to their owner. `ViewPersistenceBinding` already meets this contract. Errors remain visible and may be retried. The host owns loading, persistence and cleanup.

## Themes and multiple instances

Use standard shadcn CSS tokens on an ancestor or instance class. Provide a complete token set for dark mode, including `--selection`. Per-instance portal targets keep menus and dialogs in the same theme scope. See the [independent sheets example](../examples/independent.mdx).
