export type CellInput = string | number | boolean | null;
export type ErrorCode =
  '#ERROR!' | '#REF!' | '#VALUE!' | '#DIV/0!' | '#NAME?' | '#CYCLE!' | '#NUM!';
export interface FormulaError {
  error: ErrorCode;
  message: string;
}
export type CellValue = CellInput | FormulaError;
export interface Address {
  row: number;
  col: number;
}
export interface CellRange {
  start: Address;
  end: Address;
}
export interface CellPatch extends Address {
  input: CellInput;
}
export interface CellSnapshot {
  input: CellInput;
  value: CellValue;
  status: 'ready' | 'loading' | 'calculating' | 'error';
  message?: string;
}
export interface CellRecord extends Address, CellSnapshot {}
export interface SheetMetadata {
  rows: number;
  columns: number;
  revision: number;
}
export interface DataBlock {
  range: CellRange;
  cells: CellRecord[];
  revision: number;
}
export interface SourceEvent {
  revision: number;
  connection?: 'connected' | 'disconnected';
  error?: string;
}
export interface Mutation {
  cells?: CellPatch[];
  columns?: { col: number; formula: string | null }[];
}
export interface DataSource {
  readonly mode: 'local' | 'remote';
  readonly metadata: SheetMetadata;
  rowId(row: number): string;
  columnId(col: number): string;
  isEditable(address: Address): boolean;
  getBlock(range: CellRange, signal: AbortSignal): Promise<DataBlock>;
  mutate(mutation: Mutation, revision: number, signal: AbortSignal): Promise<{ revision: number }>;
  getColumnFormula(col: number): string | null;
  subscribe(listener: (event: SourceEvent) => void): () => void;
  dispose(): void;
}
export interface CalculationAdapter {
  calculate(range: CellRange, signal: AbortSignal): Promise<DataBlock>;
  apply(mutation: Mutation, revision: number, signal: AbortSignal): Promise<{ revision: number }>;
  dispose(): void;
}
export const cellKey = ({ row, col }: Address) => `${row}:${col}`;
export const addressFromKey = (key: string): Address => {
  const [row, col] = key.split(':').map(Number);
  return { row, col };
};
export function normalizeRange(range: CellRange): CellRange {
  return {
    start: {
      row: Math.min(range.start.row, range.end.row),
      col: Math.min(range.start.col, range.end.col),
    },
    end: {
      row: Math.max(range.start.row, range.end.row),
      col: Math.max(range.start.col, range.end.col),
    },
  };
}
export function contains(range: CellRange, address: Address) {
  return (
    address.row >= range.start.row &&
    address.row <= range.end.row &&
    address.col >= range.start.col &&
    address.col <= range.end.col
  );
}
export function columnLabel(col: number): string {
  let label = '';
  for (let n = col + 1; n > 0; n = Math.floor((n - 1) / 26))
    label = String.fromCharCode(65 + ((n - 1) % 26)) + label;
  return label;
}
export const addressLabel = (address: Address) => `${columnLabel(address.col)}${address.row + 1}`;
export function parseAddress(label: string): Address | null {
  const match = /^\$?([A-Z]+)\$?([1-9]\d*)$/i.exec(label);
  if (!match) return null;
  let col = 0;
  for (const ch of match[1].toUpperCase()) col = col * 26 + ch.charCodeAt(0) - 64;
  const row = Number(match[2]) - 1;
  return Number.isSafeInteger(col) && Number.isSafeInteger(row) ? { row, col: col - 1 } : null;
}
export function isError(value: CellValue): value is FormulaError {
  return typeof value === 'object' && value !== null;
}
export const formulaError = (error: ErrorCode, message: string): FormulaError => ({
  error,
  message,
});
