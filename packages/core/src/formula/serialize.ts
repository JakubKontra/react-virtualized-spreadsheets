import { isError } from '../cell';
import { columnLabel, type IndexSpace } from '../coords';
import type { Expression } from './ast';

/** Prints an expression back to formula text (without the leading `=`). */
export function serialize(node: Expression<IndexSpace>): string {
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
      return `${node.op}(${serialize(node.value)})`;
    case 'binary':
      return `(${serialize(node.left)}${node.op}${serialize(node.right)})`;
    case 'call':
      return `${node.name}(${node.args.map(serialize).join(',')})`;
  }
}
