import { shiftFormula } from './formula';
import {
  normalizeRange,
  type Address,
  type CellInput,
  type CellPatch,
  type CellRange,
  type CellSnapshot,
} from './types';
export const CLIPBOARD_MIME = 'application/x-ledger-clipboard';

export function parseInput(text: string): CellInput {
  if (text === '') return null;
  if (text.startsWith('=')) return text;
  if (/^(true|false)$/i.test(text)) return text.toUpperCase() === 'TRUE';
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text) && Number.isFinite(Number(text)))
    return Number(text);
  return text;
}
export function encodeTSV(rows: CellInput[][]) {
  return rows
    .map((row) =>
      row
        .map((value) => {
          const text = String(value ?? '');
          return /[\t\r\n"]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
        })
        .join('\t'),
    )
    .join('\n');
}
export function decodeTSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' && (quoted || value === '')) {
      if (quoted && text[i + 1] === '"') {
        value += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && (ch === '\t' || ch === '\n' || ch === '\r')) {
      row.push(value);
      value = '';
      if (ch !== '\t') {
        rows.push(row);
        row = [];
        if (ch === '\r' && text[i + 1] === '\n') i++;
      }
    } else value += ch;
  }
  if (value || row.length || !rows.length) {
    row.push(value);
    rows.push(row);
  }
  return rows;
}
export interface ClipboardData {
  origin: Address;
  positions?: Address[][];
  inputs: CellInput[][];
  /** Computed values captured at copy time, before TSV loses type information. */
  values?: CellInput[][];
  tsv: string;
}
export function copyRange(
  range: CellRange,
  read: (address: Address) => CellSnapshot,
  position: (address: Address) => Address = (address) => address,
): ClipboardData {
  const { start, end } = normalizeRange(range);
  const inputs: CellInput[][] = [];
  const values: CellInput[][] = [];
  const positions: Address[][] = [];
  if ((end.row - start.row + 1) * (end.col - start.col + 1) > 10000)
    throw new Error('Clipboard limit is 10,000 cells');
  for (let row = start.row; row <= end.row; row++) {
    const inputRow: CellInput[] = [];
    const valueRow: CellInput[] = [];
    const positionRow: Address[] = [];
    for (let col = start.col; col <= end.col; col++) {
      const cell = read({ row, col });
      if (cell.status === 'loading' || cell.status === 'calculating')
        throw new Error('Wait for the selected cells to load before copying');
      inputRow.push(cell.input);
      positionRow.push(position({ row, col }));
      valueRow.push(
        typeof cell.value === 'object' && cell.value !== null ? cell.value.error : cell.value,
      );
    }
    inputs.push(inputRow);
    values.push(valueRow);
    positions.push(positionRow);
  }
  return { origin: position(start), positions, inputs, values, tsv: encodeTSV(values) };
}
export interface PasteOptions {
  mode?: 'all' | 'values' | 'formulas';
  transpose?: boolean;
  /** Only enable for a verified internal clipboard token (default true for imperative callers). */
  useInternalFormulas?: boolean;
}
export function pasteCells(
  text: string,
  target: Address,
  internal?: ClipboardData | null,
  position: (address: Address) => Address = (address) => address,
  options: PasteOptions = {},
): CellPatch[] {
  const mode = options.mode ?? 'all';
  if (!['all', 'values', 'formulas'].includes(mode)) throw new Error('Unknown paste mode');
  const matching =
    options.useInternalFormulas !== false && internal?.tsv === text ? internal : null;
  const external = () => decodeTSV(text).map((row) => row.map(parseInput));
  const rows = matching
    ? mode === 'values'
      ? (matching.values ?? external())
      : matching.inputs
    : external();
  if (rows.reduce((sum, row) => sum + row.length, 0) > 10000)
    throw new Error('Clipboard limit is 10,000 cells');
  const patches: CellPatch[] = [];
  for (let r = 0; r < rows.length; r++)
    for (let c = 0; c < rows[r].length; c++) {
      const input = rows[r][c];
      if (mode === 'formulas' && !(typeof input === 'string' && input.startsWith('='))) continue;
      const address = {
        row: target.row + (options.transpose ? c : r),
        col: target.col + (options.transpose ? r : c),
      };
      const destination = position(address);
      const origin = matching?.positions?.[r]?.[c] ?? {
        row: (matching?.origin.row ?? 0) + r,
        col: (matching?.origin.col ?? 0) + c,
      };
      patches.push({
        ...address,
        input:
          mode === 'values' && typeof input === 'string'
            ? "'" + input
            : matching && typeof input === 'string'
              ? shiftFormula(input, destination.row - origin.row, destination.col - origin.col)
              : input,
      });
    }
  return patches;
}
