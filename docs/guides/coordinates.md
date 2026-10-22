# Coordinates and typed indices

Every row and column index belongs to an axis and a coordinate space. Both are part of its TypeScript type, so a column cannot be passed where a row is expected, and a persisted (canonical) index cannot be passed where a grid position is expected. All indices start at zero; ranges are inclusive.

## Three coordinate spaces

| Space       | Types                          | Meaning                                                                                                   | Used by                                                                                                         |
| ----------- | ------------------------------ | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `visible`   | `RowIndex`, `ColIndex`         | Dense positions after hiding and query projection                                                         | The store, selection, `DataSource` requests, virtual items, prop getters                                        |
| `logical`   | `LogicalRow`, `LogicalCol`     | View order including hidden items                                                                         | A1 labels, formula references, clipboard positions                                                              |
| `canonical` | `CanonicalRow`, `CanonicalCol` | Stable identity: the original source index or a monotonically allocated index for an inserted custom item | Persisted view data: cell overrides, column formulas, `columnOptions`, filters, sorts, rules, sizes, query rows |

Without a view, the three spaces coincide with the source's own indices. The generic forms are `Index<'row' | 'col', Space>` and `AxisIndex<'rows' | 'columns', Space>`; the latter maps a view axis name to its index type, for example in `ViewChange` and header gestures.

`Address<S = 'visible'>` is `{ readonly row: Index<'row', S>; readonly col: Index<'col', S> }`. `LogicalAddress` and `CanonicalAddress` are aliases for the other two spaces. `CellRange<S>` is `{ start, end }` with inclusive endpoints in the same space.

## Constructing indices

Brands carry no runtime data. Each index type has a companion object:

| Member                                     | Behavior                                                                   |
| ------------------------------------------ | -------------------------------------------------------------------------- |
| `RowIndex.of(n)`                           | Validates a non-negative safe integer; throws `SheetError` `OUT_OF_BOUNDS` |
| `RowIndex.unsafe(n)`                       | Brands without checks; for loop counters and values validated elsewhere    |
| `RowIndex.isValid(value)`                  | Type guard                                                                 |
| `.offset(i, d)`, `.clamp(n, count)`        | Arithmetic that keeps the brand; `clamp` truncates into `[0, count - 1]`   |
| `.min(a, b)`, `.max(a, b)`, `.last(count)` | Comparisons and the last index of an axis with `count` items               |

`ColIndex`, `LogicalRow`, `LogicalCol`, `CanonicalRow` and `CanonicalCol` provide the same members. `Index.unsafe<A, S>(n)` brands an index generically.

```ts
import { Address, CanonicalCol, CellRange, ColIndex, RowIndex } from '@sheet/core';

const a1 = Address.of(0, 0); // validated visible address
const b2 = Address.unsafe(1, 1); // no checks
const total = Address.of<'logical'>(9, 4); // E10 in view order
const range = CellRange.of(a1, b2); // start and end, inclusive
const next = Address.offset(a1, 1, 0); // A2
const price = CanonicalCol.of(3); // a persisted column identity
store.select(Address.clamp(250, 3, { rows: store.rows, columns: store.columns }));
store.selectAxis('columns', ColIndex.of(2));
store.selectAxis('rows', RowIndex.of(4), true);
```

`Address` also has `isValid`, `equals` and `clamp`. `CellRange` has `of`, `unsafe(r0, c0, r1, c1)`, `normalize`, `contains`, `equals`, `rows`, `columns` and `size`. `cellKey(address)` returns a `` `${row}:${col}` `` `CellKey`; `parseCellKey(key)` returns the address or `null`. `parseA1('B12')` parses an A1 label into the space it was written in and returns `null` for invalid labels. `addressLabel(address)` and `columnLabel(col)` format labels.

Other identifiers are branded too: `Revision` (data revision; `Revision.initial`, `Revision.next`), `ViewRevision`, `ViewId`, `SourceId`, `RowId` and `ColumnId`. Each has `.unsafe(...)`. A literal `0` is not a `Revision`; write `Revision.unsafe(0)` or `Revision.initial`.

## Where conversions happen

Conversions are explicit. Convert only where a value crosses spaces:

| Conversion               | API                                                                                          |
| ------------------------ | -------------------------------------------------------------------------------------------- |
| Visible → logical        | `store.logicalAddress(address)`; `store.labelAddress(address)` returns its A1 label          |
| A1 label → visible       | `store.resolveAddress('B12')`; `null` when the label is invalid or the cell is hidden        |
| Visible → canonical      | `store.view.canonical(address)`; per axis `store.view.columns.canonicalAt(col)`              |
| Canonical → visible      | `store.view.visible(address)`; `undefined` when hidden or filtered out                       |
| Logical → visible        | `store.view.fromLogical(address)`; `undefined` when hidden                                   |
| Visible → logical (view) | `store.view.logical(address)`                                                                |
| Canonical → base source  | `sourceRow`, `sourceCol`, `sourceAddress` for canonical indices within the source dimensions |
| Same values, no view     | `sameSpace(address)` re-labels an address when every space coincides                         |

`ViewAxis` (`store.view.rows` / `.columns`) also exposes `canonicalAtLogical`, `visibleIndex` and `logicalIndex`; the latter two return `undefined` for items that are not present.

For example, to filter the column under the active cell:

```ts
const view = store.view;
if (view) {
  const col = view.columns.canonicalAt(store.getSnapshot().active.col);
  store.configure({ query: { filters: [{ col, operator: 'notEmpty' }] } });
}
```

Do not derive A1 labels from a virtual row index when a query or hidden items are active; use `store.labelAddress`. See [views](../views.md) for how identities behave when items move, hide or are inserted.
