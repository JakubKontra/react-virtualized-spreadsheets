# Editing, layout and formatting

These interactions are provided by `@sheet/ui`; the headless hook exposes their building blocks. Try them in the [basic example](../examples/basic.mdx).

## Keyboard and clipboard

| Action                                  | Shortcut                      |
| --------------------------------------- | ----------------------------- |
| Start editing                           | Enter, F2 or double-click     |
| Confirm / cancel                        | Enter / Escape                |
| Move between cells                      | Arrow keys or Tab             |
| Extend selection                        | Shift + arrows or Shift-click |
| Copy / paste                            | Ctrl/⌘ C / V                  |
| Undo / redo                             | Ctrl/⌘ Z / Shift Z            |
| Fill down / right                       | Ctrl/⌘ D / R                  |
| Cycle absolute references while editing | F4 or **Toggle $ reference**  |

The address box jumps to an A1-style address. The formula bar and in-cell editor share one draft. Function suggestions, reference colors and argument help appear while editing. Browser or OS shortcuts can take precedence over function keys.

**Paste special** previews dimensions and supports original contents, computed values, formulas only, and transposition. Formulas-only leaves non-formula targets unchanged. An internal clipboard token preserves relative formulas and typed results; external text is parsed as tab-separated values. A paste is a single undoable operation, limited to 10,000 cells. Copy requires the selected cells to be loaded.

## Autofill

Drag the selection's bottom-right handle along one axis. Numeric and date series continue; formulas shift relative references while `$` anchors stay fixed. Programmatically call `await store.fill(target, sourceRange)` with a target that contains the source. Filling is subject to the same transaction limit.

## Move, hide, insert and resize

Select a header, use Shift to extend the block and drag its handle. The boundary preview snaps to the insertion position. Drag the header edge to resize. Header menus expose insertion, hiding, restoring and removal of custom items.

Source rows and columns can be hidden, not deleted from the underlying dataset. Inserted custom items can be removed. These actions change the view and support undo. Row structure changes are disabled while a sort, filter or search is active. See [view coordinates and identity](../views.md).

## Freeze panes

Use **Freeze** to pin rows and columns. The implementation limits frozen panes to 20 rows and 10 columns and further reduces the rendered pinned region when the viewport would leave too little room to scroll.

```ts
store.configure({ frozen: { rows: 1, columns: 2 } });
```

## Sort, filter and search

Use **Sort & filter** for up to three sort keys, eight filters and full-dataset text search. Queries run in the calculation layer, not just on visible cells. Settings use stable canonical column indexes, branded as `CanonicalCol`:

```ts
import { CanonicalCol } from '@sheet/core';

const stock = CanonicalCol.of(1);
store.configure({
  query: {
    sorts: [{ col: stock, direction: 'asc' }],
    filters: [{ col: stock, operator: 'lt', value: 5 }],
  },
});
```

`ColumnFilter` is a union: `empty` and `notEmpty` take no `value`; the other operators require one. `withFilterOperator(filter, operator)` switches operators and keeps the value when the new operator takes one. `FILTER_OPERATORS` and `SORT_DIRECTIONS` list the allowed values.

Clear a query with `store.configure({ query: {} })`. Filtering changes which rows are displayed; A1 references retain their logical view meaning. Selection summaries aggregate the selected result, including unloaded cells. See [formulas and filtered rows](../formulas.md).

## Typed and conditional formatting

Use **Format** for text, numbers, currency, percentages, dates, checkboxes and choice lists. Formats affect display and input validation, not the underlying number used in formulas. A percentage input of `10%` stores `0.1`. Dates use ISO strings.

```ts
store.configure({
  columnOptions: {
    1: { kind: 'number', decimals: 0 },
    2: { kind: 'select', options: ['Available', 'On order'] },
  },
  conditionalRules: [
    {
      id: 'low-stock',
      col: stock,
      operator: 'lt',
      value: 5,
      color: '#92400e',
      background: '#fef3c7',
    },
  ],
});
```

`columnOptions` is keyed by canonical column number. `ColumnOptions` is a union discriminated by `kind`: `decimals` applies to `number`, `percent` and `currency`, `currency` only to `currency`, and `options` only to `select`. `withColumnKind(option, kind)` switches kinds while keeping compatible settings; `CELL_KINDS` lists the kinds. Configuration replaces each supplied settings field. Merge the existing `columnOptions` map when changing only one column. Settings require a store created with a `view`; the [inventory example](../examples/inventory.mdx) shows the complete setup.
