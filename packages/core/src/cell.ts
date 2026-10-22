import type { Address, ColIndex, IndexSpace } from './coords';

/** A formula is any input that starts with `=`. */
export type Formula = `=${string}`;
export const isFormula = (value: unknown): value is Formula =>
  typeof value === 'string' && value.startsWith('=');

/** Raw cell content as typed by a user or supplied by a source. Formulas are strings. */
export type CellInput = string | number | boolean | null;

export const ERROR_CODES = [
  '#ERROR!',
  '#REF!',
  '#VALUE!',
  '#DIV/0!',
  '#NAME?',
  '#CYCLE!',
  '#NUM!',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface FormulaError {
  readonly error: ErrorCode;
  readonly message: string;
}
export type CellValue = CellInput | FormulaError;

export const formulaError = (error: ErrorCode, message: string): FormulaError => ({
  error,
  message,
});
export function isError(value: CellValue): value is FormulaError {
  return typeof value === 'object' && value !== null;
}
export const isCellInput = (value: unknown): value is CellInput =>
  value === null ||
  typeof value === 'string' ||
  typeof value === 'boolean' ||
  (typeof value === 'number' && Number.isFinite(value));

export const CELL_STATUSES = ['ready', 'loading', 'calculating', 'error'] as const;
export type CellStatus = (typeof CELL_STATUSES)[number];

export interface CellSnapshot {
  readonly input: CellInput;
  readonly value: CellValue;
  readonly status: CellStatus;
  readonly message?: string;
}
export type CellRecord<S extends IndexSpace = 'visible'> = Address<S> & CellSnapshot;

export interface CellPatch<S extends IndexSpace = 'visible'> extends Address<S> {
  readonly input: CellInput;
}
export interface ColumnFormulaPatch {
  readonly col: ColIndex;
  readonly formula: Formula | null;
}
