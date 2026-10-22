import { formulaError } from '../cell';
import { CellRange, parseA1, type Address, type IndexSpace } from '../coords';
import { LIMITS } from '../limits';
import { isBinaryOperator, PRECEDENCE, type Expression, type RefNode } from './ast';
import { tokenize } from './tokenize';

export function reference<S extends IndexSpace = 'visible'>(text: string): RefNode<S> {
  const address = parseA1<S>(text);
  if (!address) throw new Error('Invalid reference');
  return { type: 'ref', address, fixedCol: text.startsWith('$'), fixedRow: /\$\d/.test(text) };
}

/** Parses a formula. Syntax errors become a `#ERROR!` literal instead of throwing. */
export function parseFormula<S extends IndexSpace = 'visible'>(formula: string): Expression<S> {
  try {
    if (!formula.startsWith('=')) throw new Error('A formula must start with =');
    const tokens = tokenize(formula.slice(1));
    let pos = 0;
    let depth = 0;
    const peek = () => tokens[pos]?.text;
    const expect = (text: string) => {
      if (tokens[pos++]?.text !== text) throw new Error(`Expected ${text}`);
    };
    function primary(): Expression<S> {
      const token = tokens[pos++];
      if (!token) throw new Error('Incomplete formula');
      switch (token.kind) {
        case 'number': {
          const value = Number(token.text);
          return {
            type: 'literal',
            value: Number.isFinite(value) ? value : formulaError('#NUM!', 'Number is not finite'),
          };
        }
        case 'string':
          return { type: 'literal', value: token.text.slice(1, -1).replaceAll('""', '"') };
        case 'error':
          return {
            type: 'literal',
            value: formulaError('#REF!', 'Reference is outside the sheet'),
          };
        case 'ref': {
          const start = reference<S>(token.text);
          if (peek() !== ':') return start;
          pos++;
          const end = tokens[pos++];
          if (end?.kind !== 'ref') throw new Error('Expected range end');
          return { type: 'range', start, end: reference<S>(end.text) };
        }
        case 'name': {
          const name = token.text.toUpperCase();
          if (name === 'TRUE' || name === 'FALSE')
            return { type: 'literal', value: name === 'TRUE' };
          expect('(');
          const args: Expression<S>[] = [];
          if (peek() !== ')') {
            args.push(expression());
            while (peek() === ',') {
              pos++;
              args.push(expression());
            }
          }
          expect(')');
          return { type: 'call', name, args };
        }
        case 'op': {
          if (token.text === '+' || token.text === '-')
            return { type: 'unary', op: token.text, value: expression(5) };
          if (token.text !== '(') throw new Error(`Unexpected ${token.text}`);
          const first = expression();
          let result = first;
          if (peek() === ',') {
            const items = [first];
            while (peek() === ',') {
              pos++;
              items.push(expression());
            }
            result = { type: 'union', items };
          }
          expect(')');
          return result;
        }
      }
    }
    function expression(min = 0): Expression<S> {
      if (++depth > LIMITS.maxFormulaNesting) throw new Error('Formula nesting limit exceeded');
      let left = primary();
      for (let op = peek(); op !== undefined; op = peek()) {
        if (op === '%') {
          pos++;
          left = { type: 'binary', op: '/', left, right: { type: 'literal', value: 100 } };
          continue;
        }
        if (!isBinaryOperator(op) || PRECEDENCE[op] < min) break;
        pos++;
        const p = PRECEDENCE[op];
        left = { type: 'binary', op, left, right: expression(p + (op === '^' ? 0 : 1)) };
      }
      depth--;
      return left;
    }
    const result = expression();
    if (pos !== tokens.length) throw new Error('Unexpected trailing token');
    return result;
  } catch (error) {
    return {
      type: 'literal',
      value: formulaError('#ERROR!', error instanceof Error ? error.message : 'Invalid formula'),
    };
  }
}

export interface Dependencies<S extends IndexSpace = 'visible'> {
  readonly cells: Address<S>[];
  readonly ranges: CellRange<S>[];
}
export function dependencies<S extends IndexSpace>(expr: Expression<S>): Dependencies<S> {
  const cells: Address<S>[] = [];
  const ranges: CellRange<S>[] = [];
  function visit(node: Expression<S>) {
    switch (node.type) {
      case 'ref':
        cells.push(node.address);
        break;
      case 'range':
        ranges.push(CellRange.normalize({ start: node.start.address, end: node.end.address }));
        break;
      case 'binary':
        visit(node.left);
        visit(node.right);
        break;
      case 'unary':
        visit(node.value);
        break;
      case 'call':
        node.args.forEach(visit);
        break;
      case 'union':
        node.items.forEach(visit);
        break;
      case 'literal':
        break;
    }
  }
  visit(expr);
  return { cells, ranges };
}
