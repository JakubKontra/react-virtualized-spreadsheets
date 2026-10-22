import { invariant } from '../assert';
import { formulaError, isError, type CellValue, type FormulaError } from '../cell';
import { Address, CellRange, type IndexSpace } from '../coords';
import {
  isComparison,
  type ArithmeticOperator,
  type ComparisonOperator,
  type Expression,
} from './ast';
import {
  argumentError,
  criterionMatcher,
  isFormulaFunctionName,
  roundNumber,
  type FormulaFunctionName,
} from './functions';

function numeric(value: CellValue): number | FormulaError {
  if (isError(value)) return value;
  if (value === null || value === '') return 0;
  if (typeof value === 'boolean') return Number(value);
  const number = Number(value);
  return Number.isFinite(number) ? number : formulaError('#VALUE!', 'Expected a number');
}

type Scalar = Exclude<CellValue, FormulaError | null>;
function compare(op: ComparisonOperator, a: Scalar, b: Scalar): boolean {
  switch (op) {
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
    case '>=':
      return a >= b;
  }
}
function arithmetic(op: ArithmeticOperator, a: number, b: number): number {
  switch (op) {
    case '+':
      return a + b;
    case '-':
      return a - b;
    case '*':
      return a * b;
    case '/':
      return a / b;
    case '^':
      return a ** b;
  }
}

/** What a function implementation can do with its unevaluated arguments. */
interface Context<S extends IndexSpace> {
  /** Evaluates a scalar expression. */
  ev(node: Expression<S>): CellValue;
  /** Reads a referenced cell. */
  read(address: Address<S>): CellValue;
  /** `#REF!`/`#VALUE!` when an argument is not a valid cell, range or union of them. */
  rangeError(node: Expression<S>): FormulaError | null;
  /** Present cells of a reference argument in row-major order. */
  addresses(node: Expression<S>): Generator<Address<S>>;
  valid(address: Address<S>): boolean;
  present(address: Address<S>): boolean;
}
type FunctionImpl = <S extends IndexSpace>(
  args: readonly Expression<S>[],
  ctx: Context<S>,
) => CellValue;

/** Arity is checked before dispatch, so required arguments exist. */
function arg<S extends IndexSpace>(args: readonly Expression<S>[], index: number): Expression<S> {
  const node = args[index];
  invariant(node, `missing argument ${index}`);
  return node;
}

const isReference = <S extends IndexSpace>(node: Expression<S>) =>
  node.type === 'range' || node.type === 'union';

type AggregateKind = 'SUM' | 'AVERAGE' | 'MIN' | 'MAX' | 'COUNT';
function aggregate(kind: AggregateKind): FunctionImpl {
  return <S extends IndexSpace>(args: readonly Expression<S>[], ctx: Context<S>): CellValue => {
    let sum = 0;
    let count = 0;
    let min = Infinity;
    let max = -Infinity;
    let members = 0;
    const add = (value: CellValue): FormulaError | null => {
      if (isError(value)) return value;
      if (typeof value === 'number') {
        sum += value;
        count++;
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
      return null;
    };
    const collect = (node: Expression<S>): FormulaError | null => {
      if (node.type === 'union') {
        for (const item of node.items) {
          const error = collect(item);
          if (error) return error;
        }
        return null;
      }
      if (node.type === 'range') {
        const range = CellRange.normalize({ start: node.start.address, end: node.end.address });
        if (!ctx.valid(range.start) || !ctx.valid(range.end))
          return formulaError('#REF!', 'Range is outside the sheet');
        for (let row = range.start.row; row <= range.end.row; row++)
          for (let col = range.start.col; col <= range.end.col; col++) {
            const address = Address.unsafe<S>(row, col);
            if (!ctx.present(address)) continue;
            members++;
            const error = add(ctx.read(address));
            if (error) return error;
          }
        return null;
      }
      members++;
      return add(ctx.ev(node));
    };
    for (const node of args) {
      const before = members;
      const error = collect(node);
      if (error) return error;
      if (members === before) return formulaError('#REF!', 'All range members were removed');
    }
    let result: CellValue;
    switch (kind) {
      case 'COUNT':
        result = count;
        break;
      case 'SUM':
        result = sum;
        break;
      case 'MIN':
        result = count ? min : 0;
        break;
      case 'MAX':
        result = count ? max : 0;
        break;
      case 'AVERAGE':
        result = count ? sum / count : formulaError('#DIV/0!', 'AVERAGE has no numeric values');
        break;
    }
    return typeof result === 'number' && !Number.isFinite(result)
      ? formulaError('#NUM!', 'Result is not finite')
      : result;
  };
}

function logical(kind: 'AND' | 'OR'): FunctionImpl {
  return (args, ctx) => {
    let result = kind === 'AND';
    let count = 0;
    const combine = (value: boolean) => (kind === 'AND' ? result && value : result || value);
    for (const node of args) {
      if (isReference(node)) {
        const error = ctx.rangeError(node);
        if (error) return error;
        let members = 0;
        for (const address of ctx.addresses(node)) {
          members++;
          const value = ctx.read(address);
          if (isError(value)) return value;
          if (typeof value !== 'number' && typeof value !== 'boolean') continue;
          count++;
          result = combine(!!value);
        }
        if (!members) return formulaError('#REF!', 'All range members were removed');
      } else {
        const value = ctx.ev(node);
        if (isError(value)) return value;
        count++;
        result = combine(!!value);
      }
    }
    return count ? result : formulaError('#VALUE!', 'No logical values in range');
  };
}

function conditional(kind: 'SUMIF' | 'COUNTIF'): FunctionImpl {
  return (args, ctx) => {
    const range = arg(args, 0);
    const sumRange = args[2] ?? range;
    const invalidRange =
      ctx.rangeError(range) ?? (kind === 'SUMIF' ? ctx.rangeError(sumRange) : null);
    if (invalidRange) return invalidRange;
    const criterion = ctx.ev(arg(args, 1));
    if (isError(criterion)) return criterion;
    const matches = criterionMatcher(criterion);
    const targets = ctx.addresses(sumRange);
    let result = 0;
    let count = 0;
    for (const address of ctx.addresses(range)) {
      count++;
      const target = kind === 'SUMIF' ? targets.next() : null;
      if (target?.done)
        return formulaError('#VALUE!', 'SUMIF ranges must contain the same number of cells');
      const value = ctx.read(address);
      if (isError(value)) return value;
      if (!matches(value)) continue;
      if (kind === 'COUNTIF') result++;
      else {
        const amount = sumRange === range || !target ? value : ctx.read(target.value);
        if (isError(amount)) return amount;
        if (typeof amount === 'number') result += amount;
      }
    }
    if (!count) return formulaError('#REF!', 'All range members were removed');
    if (kind === 'SUMIF' && !targets.next().done)
      return formulaError('#VALUE!', 'SUMIF ranges must contain the same number of cells');
    return Number.isFinite(result) ? result : formulaError('#NUM!', 'Result is not finite');
  };
}

/** One implementation per catalog entry; adding a function without one does not compile. */
const IMPLEMENTATIONS: { readonly [N in FormulaFunctionName]: FunctionImpl } = {
  SUM: aggregate('SUM'),
  AVERAGE: aggregate('AVERAGE'),
  MIN: aggregate('MIN'),
  MAX: aggregate('MAX'),
  COUNT: aggregate('COUNT'),
  AND: logical('AND'),
  OR: logical('OR'),
  SUMIF: conditional('SUMIF'),
  COUNTIF: conditional('COUNTIF'),
  IF(args, ctx) {
    const condition = ctx.ev(arg(args, 0));
    if (isError(condition)) return condition;
    const otherwise = args[2];
    return condition ? ctx.ev(arg(args, 1)) : otherwise ? ctx.ev(otherwise) : false;
  },
  IFERROR(args, ctx) {
    const value = ctx.ev(arg(args, 0));
    return isError(value) ? ctx.ev(arg(args, 1)) : value;
  },
  NOT(args, ctx) {
    const value = ctx.ev(arg(args, 0));
    return isError(value) ? value : !value;
  },
  ROUND(args, ctx) {
    const value = numeric(ctx.ev(arg(args, 0)));
    if (isError(value)) return value;
    const digits = numeric(ctx.ev(arg(args, 1)));
    return isError(digits) ? digits : roundNumber(value, digits);
  },
};

export interface EvaluationBounds {
  readonly rows: number;
  readonly columns: number;
}

export function evaluate<S extends IndexSpace>(
  expr: Expression<S>,
  read: (address: Address<S>) => CellValue,
  bounds: EvaluationBounds,
  present: (address: Address<S>) => boolean = () => true,
): CellValue {
  const valid = (address: Address<S>) =>
    address.row >= 0 &&
    address.col >= 0 &&
    address.row < bounds.rows &&
    address.col < bounds.columns;
  function rangeError(node: Expression<S>): FormulaError | null {
    switch (node.type) {
      case 'union':
        for (const item of node.items) {
          const error = rangeError(item);
          if (error) return error;
        }
        return null;
      case 'ref':
        return valid(node.address) && present(node.address)
          ? null
          : formulaError('#REF!', 'Reference is outside the sheet');
      case 'range':
        return valid(node.start.address) && valid(node.end.address)
          ? null
          : formulaError('#REF!', 'Range is outside the sheet');
      default:
        return formulaError('#VALUE!', 'Expected a cell or range');
    }
  }
  function* addresses(node: Expression<S>): Generator<Address<S>> {
    if (node.type === 'union') {
      for (const item of node.items) yield* addresses(item);
    } else if (node.type === 'ref') {
      if (present(node.address)) yield node.address;
    } else if (node.type === 'range') {
      const range = CellRange.normalize({ start: node.start.address, end: node.end.address });
      for (let row = range.start.row; row <= range.end.row; row++)
        for (let col = range.start.col; col <= range.end.col; col++) {
          const address = Address.unsafe<S>(row, col);
          if (present(address)) yield address;
        }
    }
  }
  function ev(node: Expression<S>): CellValue {
    switch (node.type) {
      case 'literal':
        return node.value;
      case 'ref':
        return valid(node.address) && present(node.address)
          ? read(node.address)
          : formulaError('#REF!', 'Reference is outside the sheet');
      case 'range':
      case 'union':
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
        const op = node.op;
        if (op === '&') return String(left ?? '') + String(right ?? '');
        if (isComparison(op)) return compare(op, left ?? 0, right ?? 0);
        const a = numeric(left);
        const b = numeric(right);
        if (isError(a)) return a;
        if (isError(b)) return b;
        if (op === '/' && b === 0) return formulaError('#DIV/0!', 'Division by zero');
        const value = arithmetic(op, a, b);
        return Number.isFinite(value) ? value : formulaError('#NUM!', 'Result is not finite');
      }
      case 'call': {
        const invalidArguments = argumentError(node.name, node.args.length);
        if (invalidArguments) return invalidArguments;
        if (!isFormulaFunctionName(node.name))
          return formulaError('#NAME?', `Unknown function ${node.name}`);
        return IMPLEMENTATIONS[node.name](node.args, context);
      }
    }
  }
  const context: Context<S> = { ev, read, rangeError, addresses, valid, present };
  return ev(expr);
}
