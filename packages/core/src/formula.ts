import {
  columnLabel,
  formulaError,
  isError,
  normalizeRange,
  parseAddress,
  type Address,
  type CellRange,
  type CellValue,
} from './types';

type Ref = { type: 'ref'; address: Address; fixedRow: boolean; fixedCol: boolean };
export type Expression =
  | { type: 'literal'; value: CellValue }
  | Ref
  | { type: 'range'; start: Ref; end: Ref }
  | { type: 'unary'; op: string; value: Expression }
  | { type: 'binary'; op: string; left: Expression; right: Expression }
  | { type: 'call'; name: string; args: Expression[] };
interface Token {
  text: string;
  kind: 'number' | 'string' | 'ref' | 'name' | 'op' | 'error';
  start: number;
  end: number;
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  const re =
    /\s+|"(?:[^"]|"")*"|#REF!|\$?[A-Za-z]+\$?[1-9]\d*|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z_][A-Za-z_0-9]*|<>|<=|>=|[+\-*/^&%=<>(),:]/gy;
  let index = 0;
  while (index < source.length) {
    re.lastIndex = index;
    const match = re.exec(source);
    if (!match) throw new Error(`Unexpected character at ${index + 1}`);
    const text = match[0];
    const start = index;
    index = re.lastIndex;
    if (/^\s/.test(text)) continue;
    const kind =
      text[0] === '"'
        ? 'string'
        : text === '#REF!'
          ? 'error'
          : /^\$?[A-Za-z]+\$?\d+$/.test(text)
            ? 'ref'
            : /^[\d.]/.test(text)
              ? 'number'
              : /^[A-Za-z_]/.test(text)
                ? 'name'
                : 'op';
    tokens.push({ text, kind, start, end: index });
    if (tokens.length > 2048) throw new Error('Formula is too long');
  }
  return tokens;
}
const precedence: Record<string, number> = {
  '=': 1,
  '<>': 1,
  '<': 1,
  '>': 1,
  '<=': 1,
  '>=': 1,
  '&': 2,
  '+': 3,
  '-': 3,
  '*': 4,
  '/': 4,
  '^': 5,
};
function reference(text: string): Ref {
  const address = parseAddress(text);
  if (!address) throw new Error('Invalid reference');
  return { type: 'ref', address, fixedCol: text.startsWith('$'), fixedRow: /\$\d/.test(text) };
}
export function parseFormula(formula: string): Expression {
  try {
    if (!formula.startsWith('=')) throw new Error('A formula must start with =');
    const tokens = tokenize(formula.slice(1));
    let pos = 0;
    let depth = 0;
    const expect = (text: string) => {
      if (tokens[pos++]?.text !== text) throw new Error(`Expected ${text}`);
    };
    function expression(min = 0): Expression {
      if (++depth > 128) throw new Error('Formula nesting limit exceeded');
      const token = tokens[pos++];
      if (!token) throw new Error('Incomplete formula');
      let left: Expression;
      if (token.kind === 'number')
        left = {
          type: 'literal',
          value: Number.isFinite(Number(token.text))
            ? Number(token.text)
            : formulaError('#NUM!', 'Number is not finite'),
        };
      else if (token.kind === 'string')
        left = { type: 'literal', value: token.text.slice(1, -1).replaceAll('""', '"') };
      else if (token.kind === 'error')
        left = { type: 'literal', value: formulaError('#REF!', 'Reference is outside the sheet') };
      else if (token.kind === 'ref') {
        left = reference(token.text);
        if (tokens[pos]?.text === ':') {
          pos++;
          const end = tokens[pos++];
          if (end?.kind !== 'ref') throw new Error('Expected range end');
          left = { type: 'range', start: left, end: reference(end.text) };
        }
      } else if (token.text === '+' || token.text === '-')
        left = { type: 'unary', op: token.text, value: expression(5) };
      else if (token.text === '(') {
        left = expression();
        expect(')');
      } else if (token.kind === 'name') {
        const name = token.text.toUpperCase();
        if (name === 'TRUE' || name === 'FALSE') left = { type: 'literal', value: name === 'TRUE' };
        else {
          expect('(');
          const args: Expression[] = [];
          if (tokens[pos]?.text !== ')') {
            do {
              args.push(expression());
              if (tokens[pos]?.text !== ',') break;
              pos++;
            } while (true);
          }
          expect(')');
          left = { type: 'call', name, args };
        }
      } else throw new Error(`Unexpected ${token.text}`);
      while (tokens[pos]) {
        const op = tokens[pos].text;
        if (op === '%') {
          pos++;
          left = { type: 'binary', op: '/', left, right: { type: 'literal', value: 100 } };
          continue;
        }
        const p = precedence[op];
        if (p === undefined || p < min) break;
        pos++;
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
export function dependencies(expr: Expression): { cells: Address[]; ranges: CellRange[] } {
  const cells: Address[] = [];
  const ranges: CellRange[] = [];
  function visit(node: Expression) {
    if (node.type === 'ref') cells.push(node.address);
    else if (node.type === 'range')
      ranges.push(normalizeRange({ start: node.start.address, end: node.end.address }));
    else if (node.type === 'binary') {
      visit(node.left);
      visit(node.right);
    } else if (node.type === 'unary') visit(node.value);
    else if (node.type === 'call') node.args.forEach(visit);
  }
  visit(expr);
  return { cells, ranges };
}
export function shiftFormula(formula: string, rows: number, cols: number): string {
  if (!formula.startsWith('=')) return formula;
  try {
    const source = formula.slice(1);
    let result = '';
    let last = 0;
    for (const token of tokenize(source)) {
      if (token.kind !== 'ref') continue;
      const ref = reference(token.text);
      const row = ref.address.row + (ref.fixedRow ? 0 : rows);
      const col = ref.address.col + (ref.fixedCol ? 0 : cols);
      const text =
        row < 0 || col < 0
          ? '#REF!'
          : `${ref.fixedCol ? '$' : ''}${columnLabel(col)}${ref.fixedRow ? '$' : ''}${row + 1}`;
      result += source.slice(last, token.start) + text;
      last = token.end;
    }
    return '=' + result + source.slice(last);
  } catch {
    return formula;
  }
}
function numeric(value: CellValue): number | ReturnType<typeof formulaError> {
  if (isError(value)) return value;
  if (value === null || value === '') return 0;
  if (typeof value === 'boolean') return Number(value);
  const number = Number(value);
  return Number.isFinite(number) ? number : formulaError('#VALUE!', 'Expected a number');
}
export function evaluate(
  expr: Expression,
  read: (address: Address) => CellValue,
  bounds: { rows: number; columns: number },
): CellValue {
  const valid = (address: Address) =>
    address.row >= 0 &&
    address.col >= 0 &&
    address.row < bounds.rows &&
    address.col < bounds.columns;
  function ev(node: Expression): CellValue {
    switch (node.type) {
      case 'literal':
        return node.value;
      case 'ref':
        return valid(node.address)
          ? read(node.address)
          : formulaError('#REF!', 'Reference is outside the sheet');
      case 'range':
        return formulaError('#VALUE!', 'A range must be used inside an aggregate');
      case 'unary': {
        const value = numeric(ev(node.value));
        return isError(value) ? value : node.op === '-' ? -value : value;
      }
      case 'binary': {
        const left = ev(node.left);
        if (isError(left)) return left;
        const right = ev(node.right);
        if (isError(right)) return right;
        if (node.op === '&') return String(left ?? '') + String(right ?? '');
        if (['=', '<>', '<', '>', '<=', '>='].includes(node.op)) {
          const a = left ?? 0;
          const b = right ?? 0;
          switch (node.op) {
            case '=':
              return a === b;
            case '<>':
              return a !== b;
            case '<':
              return a < b;
            case '>':
              return a > b;
            case '<=':
              return a <= b;
            default:
              return a >= b;
          }
        }
        const a = numeric(left);
        const b = numeric(right);
        if (isError(a)) return a;
        if (isError(b)) return b;
        if (node.op === '/' && b === 0) return formulaError('#DIV/0!', 'Division by zero');
        const value =
          node.op === '+'
            ? a + b
            : node.op === '-'
              ? a - b
              : node.op === '*'
                ? a * b
                : node.op === '/'
                  ? a / b
                  : a ** b;
        return Number.isFinite(value) ? value : formulaError('#NUM!', 'Result is not finite');
      }
      case 'call': {
        if (node.name === 'IF') {
          if (node.args.length < 2 || node.args.length > 3)
            return formulaError('#VALUE!', 'IF expects 2 or 3 arguments');
          const condition = ev(node.args[0]);
          if (isError(condition)) return condition;
          return condition ? ev(node.args[1]) : node.args[2] ? ev(node.args[2]) : false;
        }
        if (!['SUM', 'AVERAGE', 'MIN', 'MAX', 'COUNT'].includes(node.name))
          return formulaError('#NAME?', `Unknown function ${node.name}`);
        if (!node.args.length) return formulaError('#VALUE!', 'Expected at least one argument');
        let sum = 0;
        let count = 0;
        let min = Infinity;
        let max = -Infinity;
        function add(value: CellValue): CellValue {
          if (isError(value)) return value;
          if (typeof value === 'number') {
            sum += value;
            count++;
            min = Math.min(min, value);
            max = Math.max(max, value);
          }
          return null;
        }
        for (const arg of node.args) {
          if (arg.type === 'range') {
            const range = normalizeRange({ start: arg.start.address, end: arg.end.address });
            if (!valid(range.start) || !valid(range.end))
              return formulaError('#REF!', 'Range is outside the sheet');
            for (let row = range.start.row; row <= range.end.row; row++)
              for (let col = range.start.col; col <= range.end.col; col++) {
                const error = add(read({ row, col }));
                if (error) return error;
              }
          } else {
            const error = add(ev(arg));
            if (error) return error;
          }
        }
        const result =
          node.name === 'COUNT'
            ? count
            : node.name === 'SUM'
              ? sum
              : node.name === 'MIN'
                ? count
                  ? min
                  : 0
                : node.name === 'MAX'
                  ? count
                    ? max
                    : 0
                  : count
                    ? sum / count
                    : formulaError('#DIV/0!', 'AVERAGE has no numeric values');
        return typeof result === 'number' && !Number.isFinite(result)
          ? formulaError('#NUM!', 'Result is not finite')
          : result;
      }
    }
  }
  return ev(expr);
}
