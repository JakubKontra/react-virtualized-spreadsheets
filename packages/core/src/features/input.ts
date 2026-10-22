import { isFormula, type CellInput } from '../cell';
import { SheetError } from '../errors';
import { isNumericKind, type ColumnOptions } from './settings';

export function isIsoDate(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}

/** Throws when an input does not satisfy the column's kind. Formulas are always accepted. */
export function validateCellInput(input: CellInput, option?: ColumnOptions): void {
  if (input === null || !option || option.kind === 'auto' || isFormula(input)) return;
  if (isNumericKind(option.kind) && (typeof input !== 'number' || !Number.isFinite(input)))
    throw new SheetError('INVALID_INPUT', 'Enter a valid number');
  if (option.kind === 'checkbox' && typeof input !== 'boolean')
    throw new SheetError('INVALID_INPUT', 'Enter TRUE or FALSE');
  const literal = typeof input === 'string' && input.startsWith("'") ? input.slice(1) : input;
  if (option.kind === 'select' && !option.options.includes(String(literal)))
    throw new SheetError('INVALID_INPUT', 'Choose a value from the list');
  if (option.kind === 'date' && (typeof literal !== 'string' || !isIsoDate(literal)))
    throw new SheetError('INVALID_INPUT', 'Enter a date as YYYY-MM-DD');
}

/** Interprets typed text according to the column's kind. */
export function parseTypedInput(text: string, option?: ColumnOptions): CellInput {
  if (text === '') return null;
  if (text.startsWith('=')) return text;
  if (option?.kind === 'text' || option?.kind === 'select' || option?.kind === 'date') return text;
  if (/^(true|false)$/i.test(text)) return text.toLowerCase() === 'true';
  if (option?.kind === 'percent' && /^[-+]?\d*\.?\d+%$/.test(text.trim()))
    return Number(text.trim().slice(0, -1)) / 100;
  return text.trim() && Number.isFinite(Number(text)) ? Number(text) : text;
}
