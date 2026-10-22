import { formulaError, type CellInput } from './types';

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
] as const;
const catalog = new Map<string, (typeof FORMULA_FUNCTIONS)[number]>(
  FORMULA_FUNCTIONS.map((f) => [f.name, f]),
);
export const getFormulaFunction = (name: string) => catalog.get(name.toUpperCase());
export function argumentError(name: string, count: number) {
  const fn = getFormulaFunction(name);
  if (!fn) return formulaError('#NAME?', `Unknown function ${name}`);
  if (count >= fn.minArgs && count <= fn.maxArgs) return null;
  const expected =
    fn.maxArgs === Infinity
      ? `at least ${fn.minArgs}`
      : fn.minArgs === fn.maxArgs
        ? String(fn.minArgs)
        : `${fn.minArgs} or ${fn.maxArgs}`;
  return formulaError(
    '#VALUE!',
    `${name} expects ${expected} argument${fn.maxArgs === 1 ? '' : 's'}`,
  );
}

/** Criteria compare numeric types strictly; text is case insensitive, blanks equal empty text. */
export function criterionMatcher(criterion: CellInput): (value: CellInput) => boolean {
  let operator = '=',
    operand: CellInput = criterion;
  if (typeof criterion === 'string') {
    const match = /^(<=|>=|<>|=|<|>)(.*)$/s.exec(criterion);
    const text = match ? match[2] : criterion;
    if (match) operator = match[1];
    operand =
      /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text) && Number.isFinite(Number(text))
        ? Number(text)
        : /^(true|false)$/i.test(text)
          ? text.toLowerCase() === 'true'
          : text;
  }
  // Wildcard matching uses a linear-space greedy matcher, avoiding user-created regex backtracking.
  const pattern: { char: string; wildcard: boolean }[] = [];
  if (typeof operand === 'string') {
    const lower = operand.toLowerCase();
    for (let i = 0; i < lower.length; i++) {
      if (lower[i] === '~' && i + 1 < lower.length && '*?~'.includes(lower[i + 1]))
        pattern.push({ char: lower[++i], wildcard: false });
      else pattern.push({ char: lower[i], wildcard: '*?'.includes(lower[i]) });
    }
  }
  const wildcardMatch = (value: string) => {
    let p = 0,
      v = 0,
      star = -1,
      retry = 0;
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
    while (pattern[p]?.wildcard && pattern[p].char === '*') p++;
    return p === pattern.length;
  };
  return (value) => {
    const a = value === null ? '' : typeof value === 'string' ? value.toLowerCase() : value;
    const b = operand === null ? '' : typeof operand === 'string' ? operand.toLowerCase() : operand;
    const sameType = typeof a === typeof b;
    const equal =
      sameType && (typeof a === 'string' && typeof b === 'string' ? wildcardMatch(a) : a === b);
    if (operator === '=') return equal;
    if (operator === '<>') return !equal;
    if (!sameType) return false;
    return operator === '<'
      ? a < b
      : operator === '>'
        ? a > b
        : operator === '<='
          ? a <= b
          : a >= b;
  };
}

export function roundNumber(value: number, digits: number) {
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
