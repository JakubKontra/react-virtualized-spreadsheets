import { formulaError, type CellInput, type FormulaError } from '../cell';
import type { ComparisonOperator } from './ast';

export interface FormulaFunctionSpec {
  readonly name: string;
  readonly signature: string;
  readonly description: string;
  readonly minArgs: number;
  readonly maxArgs: number;
}

export const FORMULA_FUNCTIONS = [
  {
    name: 'SUM',
    signature: 'SUM(number1, number2, …)',
    description: 'Add numbers and ranges',
    minArgs: 1,
    maxArgs: Infinity,
  },
  {
    name: 'AVERAGE',
    signature: 'AVERAGE(number1, number2, …)',
    description: 'Mean of numeric values',
    minArgs: 1,
    maxArgs: Infinity,
  },
  {
    name: 'MIN',
    signature: 'MIN(number1, number2, …)',
    description: 'Smallest numeric value',
    minArgs: 1,
    maxArgs: Infinity,
  },
  {
    name: 'MAX',
    signature: 'MAX(number1, number2, …)',
    description: 'Largest numeric value',
    minArgs: 1,
    maxArgs: Infinity,
  },
  {
    name: 'COUNT',
    signature: 'COUNT(value1, value2, …)',
    description: 'Count numeric values',
    minArgs: 1,
    maxArgs: Infinity,
  },
  {
    name: 'IF',
    signature: 'IF(condition, value_if_true, value_if_false?)',
    description: 'Choose a value based on a condition',
    minArgs: 2,
    maxArgs: 3,
  },
  {
    name: 'SUMIF',
    signature: 'SUMIF(range, criterion, sum_range?)',
    description: 'Sum values matching a condition',
    minArgs: 2,
    maxArgs: 3,
  },
  {
    name: 'COUNTIF',
    signature: 'COUNTIF(range, criterion)',
    description: 'Count values matching a condition',
    minArgs: 2,
    maxArgs: 2,
  },
  {
    name: 'IFERROR',
    signature: 'IFERROR(value, fallback)',
    description: 'Use a fallback when a value is an error',
    minArgs: 2,
    maxArgs: 2,
  },
  {
    name: 'ROUND',
    signature: 'ROUND(number, digits)',
    description: 'Round to a number of decimal places',
    minArgs: 2,
    maxArgs: 2,
  },
  {
    name: 'AND',
    signature: 'AND(condition1, condition2, …)',
    description: 'True when every condition is true',
    minArgs: 1,
    maxArgs: Infinity,
  },
  {
    name: 'OR',
    signature: 'OR(condition1, condition2, …)',
    description: 'True when any condition is true',
    minArgs: 1,
    maxArgs: Infinity,
  },
  {
    name: 'NOT',
    signature: 'NOT(condition)',
    description: 'Reverse a logical value',
    minArgs: 1,
    maxArgs: 1,
  },
] as const satisfies readonly FormulaFunctionSpec[];

export type FormulaFunction = (typeof FORMULA_FUNCTIONS)[number];
export type FormulaFunctionName = FormulaFunction['name'];

const catalog = new Map<string, FormulaFunction>(FORMULA_FUNCTIONS.map((f) => [f.name, f]));
export const getFormulaFunction = (name: string): FormulaFunction | undefined =>
  catalog.get(name.toUpperCase());
export const isFormulaFunctionName = (name: string): name is FormulaFunctionName =>
  catalog.has(name);

export function argumentError(name: string, count: number): FormulaError | null {
  const fn = getFormulaFunction(name);
  if (!fn) return formulaError('#NAME?', `Unknown function ${name}`);
  const { minArgs, maxArgs }: FormulaFunctionSpec = fn;
  if (count >= minArgs && count <= maxArgs) return null;
  const expected =
    maxArgs === Infinity
      ? `at least ${minArgs}`
      : minArgs === maxArgs
        ? String(minArgs)
        : `${minArgs} or ${maxArgs}`;
  return formulaError('#VALUE!', `${name} expects ${expected} argument${maxArgs === 1 ? '' : 's'}`);
}

const CRITERION = /^(<=|>=|<>|=|<|>)(.*)$/s;
const isComparisonText = (text: string): text is ComparisonOperator =>
  ['=', '<>', '<', '>', '<=', '>='].includes(text);

interface PatternChar {
  readonly char: string;
  readonly wildcard: boolean;
}

/** Criteria compare numeric types strictly; text is case insensitive, blanks equal empty text. */
export function criterionMatcher(criterion: CellInput): (value: CellInput) => boolean {
  let operator: ComparisonOperator = '=';
  let operand: CellInput = criterion;
  if (typeof criterion === 'string') {
    const match = CRITERION.exec(criterion);
    const prefix = match?.[1];
    const text = match?.[2] ?? criterion;
    if (prefix !== undefined && isComparisonText(prefix)) operator = prefix;
    operand =
      /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text) && Number.isFinite(Number(text))
        ? Number(text)
        : /^(true|false)$/i.test(text)
          ? text.toLowerCase() === 'true'
          : text;
  }
  // Wildcard matching uses a linear-space greedy matcher, avoiding user-created regex backtracking.
  const pattern: PatternChar[] = [];
  if (typeof operand === 'string') {
    const chars = operand.toLowerCase().split('');
    for (let i = 0; i < chars.length; i++) {
      const char = chars[i] ?? '';
      const escaped = chars[i + 1];
      if (char === '~' && escaped !== undefined && '*?~'.includes(escaped)) {
        pattern.push({ char: escaped, wildcard: false });
        i++;
      } else pattern.push({ char, wildcard: char === '*' || char === '?' });
    }
  }
  const wildcardMatch = (value: string) => {
    let p = 0;
    let v = 0;
    let star = -1;
    let retry = 0;
    while (v < value.length) {
      const token = pattern[p];
      if (
        token &&
        ((token.wildcard && token.char === '?') || (!token.wildcard && token.char === value[v]))
      ) {
        p++;
        v++;
      } else if (token?.wildcard && token.char === '*') {
        star = p++;
        retry = v;
      } else if (star >= 0) {
        p = star + 1;
        v = ++retry;
      } else return false;
    }
    for (let token = pattern[p]; token?.wildcard && token.char === '*'; token = pattern[p]) p++;
    return p === pattern.length;
  };
  return (value) => {
    const a = value === null ? '' : typeof value === 'string' ? value.toLowerCase() : value;
    const b = operand === null ? '' : typeof operand === 'string' ? operand.toLowerCase() : operand;
    const sameType = typeof a === typeof b;
    const equal =
      sameType && (typeof a === 'string' && typeof b === 'string' ? wildcardMatch(a) : a === b);
    switch (operator) {
      case '=':
        return equal;
      case '<>':
        return !equal;
      case '<':
        return sameType && a < b;
      case '>':
        return sameType && a > b;
      case '<=':
        return sameType && a <= b;
      case '>=':
        return sameType && a >= b;
    }
  };
}

export function roundNumber(value: number, digits: number): number | FormulaError {
  if (!Number.isInteger(digits) || Math.abs(digits) > 308)
    return formulaError('#NUM!', 'ROUND digits must be an integer between -308 and 308');
  const shift = (n: number, places: number) => {
    const [mantissa, exponent = '0'] = n.toString().split('e');
    return Number(`${mantissa}e${Number(exponent) + places}`);
  };
  const scaled = shift(Math.abs(value), digits);
  // At this precision the finite input already represents the rounded result.
  if (!Number.isFinite(scaled)) return value;
  const result = Math.sign(value) * shift(Math.round(scaled), -digits);
  return Number.isFinite(result)
    ? result === 0
      ? 0
      : result
    : formulaError('#NUM!', 'Rounded result is not finite');
}
