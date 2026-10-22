import { shiftFormula } from './formula';
import {
  contains,
  isError,
  normalizeRange,
  type Address,
  type CellInput,
  type CellPatch,
  type CellRange,
  type CellValue,
} from './types';

export type CellKind =
  'auto' | 'text' | 'number' | 'currency' | 'percent' | 'date' | 'checkbox' | 'select';
export interface ColumnOptions {
  kind: CellKind;
  decimals?: number;
  currency?: string;
  options?: string[];
}
export type FilterOperator =
  'contains' | 'equals' | 'gt' | 'gte' | 'lt' | 'lte' | 'empty' | 'notEmpty';
export interface ColumnFilter {
  col: number;
  operator: FilterOperator;
  value?: string | number | boolean;
}
export interface ViewQuery {
  sorts?: { col: number; direction: 'asc' | 'desc' }[];
  filters?: ColumnFilter[];
  search?: string;
}
export interface ConditionalRule extends ColumnFilter {
  id: string;
  color: string;
  background: string;
  bold?: boolean;
}
export interface ViewSettings {
  name?: string;
  frozen?: { rows: number; columns: number };
  query?: ViewQuery;
  columnOptions?: Record<number, ColumnOptions>;
  conditionalRules?: ConditionalRule[];
}
export interface SelectionSummary {
  count: number;
  numericCount: number;
  sum: number;
  average: number | null;
  min: number | null;
  max: number | null;
  revision: number;
}
export interface ViewRows {
  rows: Uint32Array;
  revision: number;
}
export const hasQuery = (query?: ViewQuery) =>
  !!(query?.sorts?.length || query?.filters?.length || query?.search?.trim());
export function matchesFilter(value: CellValue, filter: ColumnFilter): boolean {
  if (filter.operator === 'empty') return value === null || value === '';
  if (filter.operator === 'notEmpty') return value !== null && value !== '';
  if (isError(value) || value === null) return false;
  const expected = filter.value ?? '';
  if (filter.operator === 'contains')
    return String(value).toLocaleLowerCase().includes(String(expected).toLocaleLowerCase());
  if (filter.operator === 'equals')
    return String(value).toLocaleLowerCase() === String(expected).toLocaleLowerCase();
  if (typeof value !== 'number' || !Number.isFinite(Number(expected))) return false;
  switch (filter.operator) {
    case 'gt':
      return value > Number(expected);
    case 'gte':
      return value >= Number(expected);
    case 'lt':
      return value < Number(expected);
    case 'lte':
      return value <= Number(expected);
  }
}
export function validateSettings(settings: ViewSettings, columns: number) {
  const validCol = (col: number) => Number.isSafeInteger(col) && col >= 0 && col < columns;
  const filter = (f: ColumnFilter) =>
    validCol(f.col) &&
    ['contains', 'equals', 'gt', 'gte', 'lt', 'lte', 'empty', 'notEmpty'].includes(f.operator) &&
    (f.value === undefined || ['string', 'number', 'boolean'].includes(typeof f.value)) &&
    (typeof f.value !== 'number' || Number.isFinite(f.value));
  if (
    settings.name !== undefined &&
    (typeof settings.name !== 'string' || !settings.name.trim() || settings.name.length > 100)
  )
    throw new Error('View name must contain 1–100 characters');
  if (
    settings.frozen &&
    (!Number.isInteger(settings.frozen.rows) ||
      settings.frozen.rows < 0 ||
      settings.frozen.rows > 20 ||
      !Number.isInteger(settings.frozen.columns) ||
      settings.frozen.columns < 0 ||
      settings.frozen.columns > 10)
  )
    throw new Error('Freeze up to 20 rows and 10 columns');
  const q = settings.query;
  if (
    q &&
    ((q.sorts &&
      (!Array.isArray(q.sorts) ||
        q.sorts.length > 3 ||
        q.sorts.some((s) => !validCol(s.col) || !['asc', 'desc'].includes(s.direction)))) ||
      (q.filters &&
        (!Array.isArray(q.filters) || q.filters.length > 8 || q.filters.some((f) => !filter(f)))) ||
      (q.search !== undefined && (typeof q.search !== 'string' || q.search.length > 200)))
  )
    throw new Error('Invalid query (maximum 3 sorts and 8 filters)');
  for (const [col, option] of Object.entries(settings.columnOptions ?? {})) {
    if (
      !validCol(Number(col)) ||
      !option ||
      !['auto', 'text', 'number', 'currency', 'percent', 'date', 'checkbox', 'select'].includes(
        option.kind,
      ) ||
      (option.decimals !== undefined &&
        (!Number.isInteger(option.decimals) || option.decimals < 0 || option.decimals > 10)) ||
      (option.currency !== undefined && !/^[A-Z]{3}$/.test(option.currency)) ||
      (option.options !== undefined &&
        (!Array.isArray(option.options) ||
          option.options.length > 100 ||
          option.options.some((v) => typeof v !== 'string' || v.length > 200)))
    )
      throw new Error('Invalid column format');
  }
  if (
    settings.conditionalRules &&
    (!Array.isArray(settings.conditionalRules) ||
      settings.conditionalRules.length > 32 ||
      settings.conditionalRules.some(
        (r) =>
          !filter(r) ||
          typeof r.id !== 'string' ||
          !/^#[\da-f]{6}$/i.test(r.color) ||
          !/^#[\da-f]{6}$/i.test(r.background) ||
          (r.bold !== undefined && typeof r.bold !== 'boolean'),
      ))
  )
    throw new Error('Invalid conditional formatting rule');
}
export function validateCellInput(input: CellInput, option?: ColumnOptions) {
  if (
    input === null ||
    !option ||
    option.kind === 'auto' ||
    (typeof input === 'string' && input.startsWith('='))
  )
    return;
  if (
    ['number', 'currency', 'percent'].includes(option.kind) &&
    (typeof input !== 'number' || !Number.isFinite(input))
  )
    throw new Error('Enter a valid number');
  if (option.kind === 'checkbox' && typeof input !== 'boolean')
    throw new Error('Enter TRUE or FALSE');
  const literal = typeof input === 'string' && input.startsWith("'") ? input.slice(1) : input;
  if (option.kind === 'select' && !option.options?.includes(String(literal)))
    throw new Error('Choose a value from the list');
  if (option.kind === 'date' && (typeof literal !== 'string' || !isDate(literal)))
    throw new Error('Enter a date as YYYY-MM-DD');
}
function isDate(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
export function parseTypedInput(text: string, option?: ColumnOptions): CellInput {
  if (text === '') return null;
  if (text.startsWith('=')) return text;
  if (option?.kind === 'text' || option?.kind === 'select' || option?.kind === 'date') return text;
  if (/^(true|false)$/i.test(text)) return text.toLowerCase() === 'true';
  if (option?.kind === 'percent' && /^[-+]?\d*\.?\d+%$/.test(text.trim()))
    return Number(text.trim().slice(0, -1)) / 100;
  return text.trim() && Number.isFinite(Number(text)) ? Number(text) : text;
}
const numberFormats = new Map<string, Intl.NumberFormat>();
export function formatCellValue(
  value: CellValue,
  option?: ColumnOptions,
  locale = 'en-GB',
): string {
  if (isError(value)) return value.error;
  if (value === null) return '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value !== 'number' || option?.kind === 'text') return String(value);
  const key = `${locale}:${option?.kind}:${option?.decimals}:${option?.currency}`;
  let formatter = numberFormats.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      style:
        option?.kind === 'currency'
          ? 'currency'
          : option?.kind === 'percent'
            ? 'percent'
            : 'decimal',
      currency: option?.currency ?? 'EUR',
      maximumFractionDigits: option?.decimals ?? 2,
      minimumFractionDigits: option?.decimals,
    });
    if (numberFormats.size > 100) numberFormats.clear();
    numberFormats.set(key, formatter);
  }
  return formatter.format(value);
}
/** Repeat a pattern, extrapolate numbers/dates, and rebase formulas using logical positions. */
export function createFillPatches(
  source: CellRange,
  target: CellRange,
  read: (a: Address) => CellInput,
  logical: (a: Address) => Address = (a) => a,
): CellPatch[] {
  source = normalizeRange(source);
  target = normalizeRange(target);
  if (!contains(target, source.start) || !contains(target, source.end))
    throw new Error('Fill must include the source selection');
  const vertical = target.start.col === source.start.col && target.end.col === source.end.col;
  const horizontal = target.start.row === source.start.row && target.end.row === source.end.row;
  if (!vertical && !horizontal) throw new Error('Fill in one direction at a time');
  if ((target.end.row - target.start.row + 1) * (target.end.col - target.start.col + 1) > 10000)
    throw new Error('Fill at most 10,000 cells');
  const length = vertical
    ? source.end.row - source.start.row + 1
    : source.end.col - source.start.col + 1;
  const patches: CellPatch[] = [];
  const lines = new Map<
    number,
    { values: CellInput[]; numericStep?: number; dateStep?: number; dateBase?: number }
  >();
  for (let row = target.start.row; row <= target.end.row; row++)
    for (let col = target.start.col; col <= target.end.col; col++) {
      if (contains(source, { row, col })) continue;
      const offset = vertical ? row - source.start.row : col - source.start.col;
      const index = ((offset % length) + length) % length;
      const origin = {
        row: vertical ? source.start.row + index : row,
        col: vertical ? col : source.start.col + index,
      };
      const first = {
        row: vertical ? source.start.row : row,
        col: vertical ? col : source.start.col,
      };
      const key = vertical ? col : row;
      let pattern = lines.get(key);
      if (!pattern) {
        const values = Array.from({ length }, (_, i) =>
          read({ row: first.row + (vertical ? i : 0), col: first.col + (vertical ? 0 : i) }),
        );
        pattern = { values };
        if (length >= 2 && values.every((v) => typeof v === 'number')) {
          const step = (values[1] as number) - (values[0] as number);
          if (
            values.every(
              (v, i) => Math.abs((v as number) - (values[0] as number) - i * step) < 1e-8,
            )
          )
            pattern.numericStep = step;
        } else if (values.every((v) => typeof v === 'string' && isDate(v))) {
          const times = values.map((v) => Date.parse(v as string)),
            step = length === 1 ? 86400000 : times[1] - times[0];
          if (times.every((v, i) => v - times[0] === i * step)) {
            pattern.dateBase = times[0];
            pattern.dateStep = step;
          }
        }
        lines.set(key, pattern);
      }
      let input = pattern.values[index];
      if (typeof input === 'string' && input.startsWith('=')) {
        const from = logical(origin),
          to = logical({ row, col });
        input = shiftFormula(input, to.row - from.row, to.col - from.col);
      } else if (pattern.numericStep !== undefined)
        input = (pattern.values[0] as number) + offset * pattern.numericStep;
      else if (pattern.dateBase !== undefined)
        input = new Date(pattern.dateBase + offset * pattern.dateStep!).toISOString().slice(0, 10);
      patches.push({ row, col, input });
    }
  return patches;
}
