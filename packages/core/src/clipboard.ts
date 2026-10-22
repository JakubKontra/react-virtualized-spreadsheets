import { isError, isFormula, type CellInput, type CellPatch, type CellSnapshot } from './cell';
import { Address, CellRange, sameSpace, type LogicalAddress } from './coords';
import { SheetError } from './errors';
import { shiftFormula } from './formula';
import { LIMITS } from './limits';

export const CLIPBOARD_MIME = 'application/x-ledger-clipboard';

/** Interprets pasted text without column-specific rules. */
export function parseInput(text: string): CellInput {
  if (text === '') return null;
  if (text.startsWith('=')) return text;
  if (/^(true|false)$/i.test(text)) return text.toUpperCase() === 'TRUE';
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text) && Number.isFinite(Number(text)))
    return Number(text);
  return text;
}
export function encodeTSV(rows: readonly (readonly CellInput[])[]): string {
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

/** An internal copy, kept so pastes can rebase formulas and preserve types. */
export interface ClipboardData {
  /** Logical position of the top-left copied cell. */
  readonly origin: LogicalAddress;
  /** Logical position of each copied cell; positions can be discontiguous in a view. */
  readonly positions?: readonly (readonly LogicalAddress[])[];
  readonly inputs: readonly (readonly CellInput[])[];
  /** Computed values captured at copy time, before TSV loses type information. */
  readonly values?: readonly (readonly CellInput[])[];
  readonly tsv: string;
}
export function copyRange(
  range: CellRange,
  read: (address: Address) => CellSnapshot,
  position: (address: Address) => LogicalAddress = sameSpace,
): ClipboardData {
  const { start, end } = CellRange.normalize(range);
  if (CellRange.size({ start, end }) > LIMITS.maxEditCells)
    throw new SheetError('LIMIT_EXCEEDED', 'Clipboard limit is 10,000 cells');
  const inputs: CellInput[][] = [];
  const values: CellInput[][] = [];
  const positions: LogicalAddress[][] = [];
  for (let row = start.row; row <= end.row; row++) {
    const inputRow: CellInput[] = [];
    const valueRow: CellInput[] = [];
    const positionRow: LogicalAddress[] = [];
    for (let col = start.col; col <= end.col; col++) {
      const address = Address.unsafe(row, col);
      const cell = read(address);
      if (cell.status === 'loading' || cell.status === 'calculating')
        throw new SheetError('BUSY', 'Wait for the selected cells to load before copying');
      inputRow.push(cell.input);
      positionRow.push(position(address));
      valueRow.push(isError(cell.value) ? cell.value.error : cell.value);
    }
    inputs.push(inputRow);
    values.push(valueRow);
    positions.push(positionRow);
  }
  return { origin: position(start), positions, inputs, values, tsv: encodeTSV(values) };
}

export const PASTE_MODES = ['all', 'values', 'formulas'] as const;
export type PasteMode = (typeof PASTE_MODES)[number];
export const isPasteMode = (value: unknown): value is PasteMode =>
  PASTE_MODES.some((mode) => mode === value);

export interface PasteOptions {
  readonly mode?: PasteMode | undefined;
  readonly transpose?: boolean | undefined;
  /** Only enable for a verified internal clipboard token (default true for imperative callers). */
  readonly useInternalFormulas?: boolean | undefined;
}
export function pasteCells(
  text: string,
  target: Address,
  internal?: ClipboardData | null,
  position: (address: Address) => LogicalAddress = sameSpace,
  options: PasteOptions = {},
): CellPatch[] {
  const mode = options.mode ?? 'all';
  if (!isPasteMode(mode)) throw new SheetError('INVALID_INPUT', 'Unknown paste mode');
  const matching =
    options.useInternalFormulas !== false && internal?.tsv === text ? internal : null;
  const external = () => decodeTSV(text).map((row) => row.map(parseInput));
  const rows = matching
    ? mode === 'values'
      ? (matching.values ?? external())
      : matching.inputs
    : external();
  if (rows.reduce((sum, row) => sum + row.length, 0) > LIMITS.maxEditCells)
    throw new SheetError('LIMIT_EXCEEDED', 'Clipboard limit is 10,000 cells');
  const patches: CellPatch[] = [];
  rows.forEach((cells, r) =>
    cells.forEach((input, c) => {
      if (mode === 'formulas' && !isFormula(input)) return;
      const address = Address.offset(target, options.transpose ? c : r, options.transpose ? r : c);
      const destination = position(address);
      const origin =
        matching?.positions?.[r]?.[c] ??
        Address.unsafe<'logical'>((matching?.origin.row ?? 0) + r, (matching?.origin.col ?? 0) + c);
      patches.push({
        ...address,
        input:
          mode === 'values' && typeof input === 'string'
            ? "'" + input
            : matching && isFormula(input)
              ? shiftFormula(input, destination.row - origin.row, destination.col - origin.col)
              : input,
      });
    }),
  );
  return patches;
}
