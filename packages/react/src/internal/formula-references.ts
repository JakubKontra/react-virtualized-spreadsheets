import {
  FORMULA_FUNCTIONS,
  maskFormulaStrings,
  parseA1,
  type FormulaFunction,
  type LogicalAddress,
} from '@sheet/core';

export const REFERENCE_COLORS = ['#2563eb', '#a855f7', '#d97706', '#08916d'] as const;
export type ReferenceColor = (typeof REFERENCE_COLORS)[number];

/** An A1 reference or range typed in a formula draft, in logical coordinates. */
export interface FormulaReference {
  readonly label: string;
  readonly start: LogicalAddress;
  readonly end: LogicalAddress;
  readonly color: ReferenceColor;
}

export const unquoted = (text: string) => maskFormulaStrings(text).text;

const REFERENCE = /\$?[A-Z]+\$?[1-9]\d*(?::\$?[A-Z]+\$?[1-9]\d*)?/gi;

export function formulaReferences(draft: string): FormulaReference[] {
  const result: FormulaReference[] = [];
  for (const match of unquoted(draft).matchAll(REFERENCE)) {
    const [first = '', second] = match[0].split(':');
    const start = parseA1<'logical'>(first);
    const end = parseA1<'logical'>(second ?? first);
    if (!start || !end) continue;
    result.push({
      label: match[0],
      start,
      end,
      color: REFERENCE_COLORS[result.length % REFERENCE_COLORS.length] ?? REFERENCE_COLORS[0],
    });
  }
  return result;
}

export const referenceContains = (reference: FormulaReference, address: LogicalAddress) =>
  address.row >= Math.min(reference.start.row, reference.end.row) &&
  address.row <= Math.max(reference.start.row, reference.end.row) &&
  address.col >= Math.min(reference.start.col, reference.end.col) &&
  address.col <= Math.max(reference.start.col, reference.end.col);

/** The innermost function call around the caret and the argument the caret is in. */
export interface CallContext {
  readonly name: string;
  readonly argument: number;
}
export function callAt(textBeforeCaret: string): CallContext | undefined {
  const stack: { name: string; argument: number }[] = [];
  for (const match of textBeforeCaret.matchAll(/(?<name>[A-Z]+)\s*\(|(?<punct>[(),])/gi)) {
    const { name, punct } = match.groups ?? {};
    if (name) stack.push({ name: name.toUpperCase(), argument: 0 });
    else if (punct === '(') stack.push({ name: '', argument: 0 });
    else if (punct === ')') stack.pop();
    else {
      const top = stack.at(-1);
      if (top) top.argument++;
    }
  }
  return stack.at(-1);
}

/** The partial function name directly before the caret, if any. */
export const completionToken = (textBeforeCaret: string): string | null =>
  /(?<name>[A-Z]+)$/i.exec(textBeforeCaret)?.groups?.['name'] ?? null;

export const functionsStartingWith = (prefix: string): readonly FormulaFunction[] =>
  FORMULA_FUNCTIONS.filter((f) => f.name.startsWith(prefix.toUpperCase()));
