import { formulaError, isError, isFormula, type CellInput, type Formula } from '../cell';
import { Address, CellRange, type AxisName, type Index, type IndexSpace } from '../coords';
import { parseFormula, serialize, type Expression, type RefNode } from '../formula';
import { ViewAxis, type AxisSpan } from './axis';
import type { SheetViewState } from './state';

/**
 * - `bind`: formula text typed by a user (logical A1, including hidden items) → canonical text.
 * - `display`: stored canonical text → logical A1 text.
 */
export type FormulaDirection = 'bind' | 'display';

/** How references move from one coordinate space to another. */
interface SpaceMapper<In extends IndexSpace, Out extends IndexSpace> {
  index<A extends AxisName>(axis: ViewAxis<A>, index: Index<A, In>): Index<A, Out> | undefined;
  spans<A extends AxisName>(
    axis: ViewAxis<A>,
    start: Index<A, In>,
    end: Index<A, In>,
  ): readonly AxisSpan<A, Out>[];
  /** Drop union members whose whole range disappeared instead of turning them into `#REF!`. */
  readonly dropRemoved: boolean;
}

const BIND: SpaceMapper<'logical', 'canonical'> = {
  index<A extends AxisName>(axis: ViewAxis<A>, index: Index<A, 'logical'>) {
    return axis.canonicalAtLogical(index);
  },
  spans<A extends AxisName>(
    axis: ViewAxis<A>,
    start: Index<A, 'logical'>,
    end: Index<A, 'logical'>,
  ) {
    return end >= axis.logicalCount ? [] : axis.logicalSlice(start, end - start + 1);
  },
  dropRemoved: false,
};
const DISPLAY: SpaceMapper<'canonical', 'logical'> = {
  index<A extends AxisName>(axis: ViewAxis<A>, index: Index<A, 'canonical'>) {
    return axis.logicalIndex(index);
  },
  spans<A extends AxisName>(
    axis: ViewAxis<A>,
    start: Index<A, 'canonical'>,
    end: Index<A, 'canonical'>,
  ) {
    return axis.logicalSpans({ start, count: end - start + 1 });
  },
  dropRemoved: true,
};

const removed = <S extends IndexSpace>(): Expression<S> => ({
  type: 'literal',
  value: formulaError('#REF!', 'Referenced item was removed'),
});
const isRefError = (node: Expression<IndexSpace>) =>
  node.type === 'literal' && isError(node.value) && node.value.error === '#REF!';
const single = <S extends IndexSpace>(items: Expression<S>[]): Expression<S> => {
  const [only] = items;
  return !only ? removed() : items.length === 1 ? only : { type: 'union', items };
};

function transform<In extends IndexSpace, Out extends IndexSpace>(
  mapper: SpaceMapper<In, Out>,
  rows: ViewAxis<'row'>,
  columns: ViewAxis<'col'>,
  node: Expression<In>,
): Expression<Out> {
  const recurse = (child: Expression<In>) => transform(mapper, rows, columns, child);
  switch (node.type) {
    case 'literal':
      return node;
    case 'ref':
      try {
        const row = mapper.index(rows, node.address.row);
        const col = mapper.index(columns, node.address.col);
        return row === undefined || col === undefined
          ? removed()
          : { ...node, address: { row, col } };
      } catch {
        return removed();
      }
    case 'range': {
      const { start, end } = CellRange.normalize({
        start: node.start.address,
        end: node.end.address,
      });
      const rowsAscending = node.start.address.row <= node.end.address.row;
      const colsAscending = node.start.address.col <= node.end.address.col;
      // Normalize each axis together with its own absolute/relative anchor.
      const low: Omit<RefNode<Out>, 'address'> = {
        type: 'ref',
        fixedRow: rowsAscending ? node.start.fixedRow : node.end.fixedRow,
        fixedCol: colsAscending ? node.start.fixedCol : node.end.fixedCol,
      };
      const high: Omit<RefNode<Out>, 'address'> = {
        type: 'ref',
        fixedRow: rowsAscending ? node.end.fixedRow : node.start.fixedRow,
        fixedCol: colsAscending ? node.end.fixedCol : node.start.fixedCol,
      };
      const rr = mapper.spans(rows, start.row, end.row);
      const cc = mapper.spans(columns, start.col, end.col);
      return single(
        rr.flatMap((r) =>
          cc.map((c): Expression<Out> => ({
            type: 'range',
            start: { ...low, address: { row: r.start, col: c.start } },
            end: {
              ...high,
              address: Address.unsafe<Out>(r.start + r.count - 1, c.start + c.count - 1),
            },
          })),
        ),
      );
    }
    case 'union':
      return single(
        node.items
          .map((item) => ({ item, mapped: recurse(item) }))
          .filter(
            ({ item, mapped }) =>
              !(
                mapper.dropRemoved &&
                (item.type === 'range' || item.type === 'union') &&
                isRefError(mapped)
              ),
          )
          .map(({ mapped }) => mapped),
      );
    case 'binary':
      return { ...node, left: recurse(node.left), right: recurse(node.right) };
    case 'unary':
      return { ...node, value: recurse(node.value) };
    case 'call':
      return { ...node, args: node.args.map(recurse) };
  }
}

function run<In extends IndexSpace, Out extends IndexSpace>(
  mapper: SpaceMapper<In, Out>,
  formula: Formula,
  rows: ViewAxis<'row'>,
  columns: ViewAxis<'col'>,
): Formula {
  const expression = parseFormula<In>(formula);
  if (expression.type === 'literal' && isError(expression.value)) return formula;
  return `=${serialize(transform(mapper, rows, columns, expression))}`;
}

/** Rebind an A1 expression between canonical identities and logical (including hidden) positions. */
export function mapViewFormula(
  formula: Formula,
  view: SheetViewState,
  direction: FormulaDirection,
): Formula {
  const rows = new ViewAxis(view.rows);
  const columns = new ViewAxis(view.columns);
  if (rows.isIdentity && columns.isIdentity) return formula;
  return direction === 'bind'
    ? run(BIND, formula, rows, columns)
    : run(DISPLAY, formula, rows, columns);
}

/** Binds a typed input to canonical identities; non-formulas pass through. */
export const bindInput = (input: CellInput, view: SheetViewState): CellInput =>
  isFormula(input) ? mapViewFormula(input, view, 'bind') : input;
/** Displays a stored input in logical A1 positions; non-formulas pass through. */
export const displayInput = (input: CellInput, view: SheetViewState): CellInput =>
  isFormula(input) ? mapViewFormula(input, view, 'display') : input;
