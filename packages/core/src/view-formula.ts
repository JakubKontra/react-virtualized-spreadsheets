import { parseFormula, type Expression } from './formula';
import { columnLabel, formulaError, isError, normalizeRange } from './types';
import { ViewAxis, type AxisSpan, type SheetViewState } from './view';

function serialize(node: Expression): string {
  switch (node.type) {
    case 'literal':
      return isError(node.value)
        ? node.value.error
        : typeof node.value === 'string'
          ? `"${node.value.replaceAll('"', '""')}"`
          : typeof node.value === 'boolean'
            ? String(node.value).toUpperCase()
            : String(node.value ?? 0);
    case 'ref':
      return `${node.fixedCol ? '$' : ''}${columnLabel(node.address.col)}${node.fixedRow ? '$' : ''}${node.address.row + 1}`;
    case 'range':
      return `${serialize(node.start)}:${serialize(node.end)}`;
    case 'union':
      return `(${node.items.map(serialize).join(',')})`;
    case 'unary':
      return node.op === '%'
        ? `(${serialize(node.value)})%`
        : `${node.op}(${serialize(node.value)})`;
    case 'binary':
      return `(${serialize(node.left)}${node.op}${serialize(node.right)})`;
    case 'call':
      return `${node.name}(${node.args.map(serialize).join(',')})`;
  }
}
/** Rebind an A1 expression between canonical identities and logical (including hidden) positions. */
export function mapViewFormula(
  formula: string,
  view: SheetViewState,
  direction: 'bind' | 'display',
): string {
  if (!formula.startsWith('=')) return formula;
  const rows = new ViewAxis(view.rows);
  const columns = new ViewAxis(view.columns);
  const identity = (axis: ViewAxis) =>
    axis.state.order.length === 1 &&
    axis.state.order[0].start === 0 &&
    axis.state.order[0].count === axis.state.nextIndex;
  if (identity(rows) && identity(columns)) return formula;
  const expression = parseFormula(formula);
  if (expression.type === 'literal' && isError(expression.value)) return formula;
  const invalid = (): Expression => ({
    type: 'literal',
    value: formulaError('#REF!', 'Referenced item was removed'),
  });
  function spans(axis: ViewAxis, start: number, end: number): AxisSpan[] {
    if (direction === 'display') return axis.logicalSpans({ start, count: end - start + 1 });
    if (end >= axis.logicalCount) return [];
    return axis.logicalSlice(start, end - start + 1);
  }
  function transform(node: Expression): Expression {
    if (node.type === 'ref') {
      try {
        const row =
          direction === 'bind'
            ? rows.canonicalAtLogical(node.address.row)
            : rows.logicalIndex(node.address.row);
        const col =
          direction === 'bind'
            ? columns.canonicalAtLogical(node.address.col)
            : columns.logicalIndex(node.address.col);
        return row < 0 || col < 0 ? invalid() : { ...node, address: { row, col } };
      } catch {
        return invalid();
      }
    }
    if (node.type === 'range') {
      const { start, end } = normalizeRange({ start: node.start.address, end: node.end.address });
      // Normalize each axis together with its own absolute/relative anchor.
      const low = {
        ...node.start,
        fixedRow:
          node.start.address.row <= node.end.address.row ? node.start.fixedRow : node.end.fixedRow,
        fixedCol:
          node.start.address.col <= node.end.address.col ? node.start.fixedCol : node.end.fixedCol,
      };
      const high = {
        ...node.end,
        fixedRow:
          node.start.address.row <= node.end.address.row ? node.end.fixedRow : node.start.fixedRow,
        fixedCol:
          node.start.address.col <= node.end.address.col ? node.end.fixedCol : node.start.fixedCol,
      };
      const rr = spans(rows, start.row, end.row);
      const cc = spans(columns, start.col, end.col);
      const items: Expression[] = rr.flatMap((r) =>
        cc.map((c) => ({
          type: 'range' as const,
          start: { ...low, address: { row: r.start, col: c.start } },
          end: { ...high, address: { row: r.start + r.count - 1, col: c.start + c.count - 1 } },
        })),
      );
      return !items.length ? invalid() : items.length === 1 ? items[0] : { type: 'union', items };
    }
    if (node.type === 'union') {
      const items = node.items
        .map((item) => ({ item, mapped: transform(item) }))
        .filter(
          ({ item, mapped }) =>
            !(
              direction === 'display' &&
              (item.type === 'range' || item.type === 'union') &&
              mapped.type === 'literal' &&
              isError(mapped.value) &&
              mapped.value.error === '#REF!'
            ),
        )
        .map(({ mapped }) => mapped);
      return !items.length ? invalid() : items.length === 1 ? items[0] : { type: 'union', items };
    }
    if (node.type === 'binary')
      return { ...node, left: transform(node.left), right: transform(node.right) };
    if (node.type === 'unary') return { ...node, value: transform(node.value) };
    if (node.type === 'call') return { ...node, args: node.args.map(transform) };
    return node;
  }
  return '=' + serialize(transform(expression));
}
