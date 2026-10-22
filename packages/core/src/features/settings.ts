import type { CanonicalCol } from '../coords';

export const CELL_KINDS = [
  'auto',
  'text',
  'number',
  'currency',
  'percent',
  'date',
  'checkbox',
  'select',
] as const;
export type CellKind = (typeof CELL_KINDS)[number];
export type NumericKind = Extract<CellKind, 'number' | 'currency' | 'percent'>;
export const isCellKind = (value: unknown): value is CellKind =>
  CELL_KINDS.some((kind) => kind === value);
export const isNumericKind = (kind: CellKind): kind is NumericKind =>
  kind === 'number' || kind === 'currency' || kind === 'percent';

/** ISO 4217 code such as `EUR`. */
export type CurrencyCode = string;
export const DEFAULT_CURRENCY: CurrencyCode = 'EUR';
export const DEFAULT_DECIMALS = 2;

/** Column presentation and validation, discriminated by `kind`. */
export type ColumnOptions =
  | { readonly kind: 'auto' | 'text' | 'date' | 'checkbox' }
  | { readonly kind: 'number' | 'percent'; readonly decimals?: number }
  | { readonly kind: 'currency'; readonly currency?: CurrencyCode; readonly decimals?: number }
  | { readonly kind: 'select'; readonly options: readonly string[] };
export type ColumnOptionsOf<K extends CellKind> = Extract<ColumnOptions, { kind: K }>;

export const decimalsOf = (option: ColumnOptions | undefined): number | undefined =>
  option && 'decimals' in option ? option.decimals : undefined;

/** Switches kind while keeping settings the new kind understands. */
export function withColumnKind(option: ColumnOptions | undefined, kind: CellKind): ColumnOptions {
  const decimals = decimalsOf(option);
  const keep = decimals === undefined ? {} : { decimals };
  switch (kind) {
    case 'auto':
    case 'text':
    case 'date':
    case 'checkbox':
      return { kind };
    case 'number':
    case 'percent':
      return { kind, ...keep };
    case 'currency':
      return {
        kind,
        currency:
          option?.kind === 'currency' ? (option.currency ?? DEFAULT_CURRENCY) : DEFAULT_CURRENCY,
        ...keep,
      };
    case 'select':
      return { kind, options: option?.kind === 'select' ? option.options : [] };
  }
}

export const FILTER_OPERATORS = [
  'contains',
  'equals',
  'gt',
  'gte',
  'lt',
  'lte',
  'empty',
  'notEmpty',
] as const;
export type FilterOperator = (typeof FILTER_OPERATORS)[number];
/** Operators that test presence and take no value. */
export type PresenceOperator = Extract<FilterOperator, 'empty' | 'notEmpty'>;
export type ValueOperator = Exclude<FilterOperator, PresenceOperator>;
export type FilterValue = string | number | boolean;
export const isFilterOperator = (value: unknown): value is FilterOperator =>
  FILTER_OPERATORS.some((op) => op === value);
export const operatorTakesValue = (op: FilterOperator): op is ValueOperator =>
  op !== 'empty' && op !== 'notEmpty';

/** A predicate on one canonical column. Numeric operators coerce text values with `Number`. */
export type ColumnFilter =
  | { readonly col: CanonicalCol; readonly operator: PresenceOperator }
  | { readonly col: CanonicalCol; readonly operator: ValueOperator; readonly value: FilterValue };

export const filterValue = (filter: ColumnFilter): FilterValue | undefined =>
  'value' in filter ? filter.value : undefined;

function filterWith(
  col: CanonicalCol,
  operator: FilterOperator,
  value?: FilterValue,
): ColumnFilter {
  return operatorTakesValue(operator) ? { col, operator, value: value ?? '' } : { col, operator };
}
/** Changes the operator, keeping the value when the new operator takes one. */
export const withFilterOperator = (filter: ColumnFilter, operator: FilterOperator): ColumnFilter =>
  filterWith(filter.col, operator, filterValue(filter));
/** Sets the value; presence operators ignore it. */
export const withFilterValue = (filter: ColumnFilter, value: FilterValue): ColumnFilter =>
  filterWith(filter.col, filter.operator, value);

export const SORT_DIRECTIONS = ['asc', 'desc'] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];
export const isSortDirection = (value: unknown): value is SortDirection =>
  value === 'asc' || value === 'desc';

export interface ColumnSort {
  readonly col: CanonicalCol;
  readonly direction: SortDirection;
}
export interface ViewQuery {
  readonly sorts?: readonly ColumnSort[];
  readonly filters?: readonly ColumnFilter[];
  readonly search?: string;
}
export type ConditionalRule = ColumnFilter & {
  readonly id: string;
  /** `#rrggbb` */
  readonly color: string;
  /** `#rrggbb` */
  readonly background: string;
  readonly bold?: boolean;
};
function ruleWith(rule: ConditionalRule, filter: ColumnFilter): ConditionalRule {
  const { id, color, background, bold } = rule;
  return { ...filter, id, color, background, ...(bold === undefined ? {} : { bold }) };
}
export const withRuleOperator = (rule: ConditionalRule, operator: FilterOperator) =>
  ruleWith(rule, withFilterOperator(rule, operator));
export const withRuleValue = (rule: ConditionalRule, value: FilterValue) =>
  ruleWith(rule, withFilterValue(rule, value));

export interface FrozenPanes {
  readonly rows: number;
  readonly columns: number;
}
export interface ViewSettings {
  readonly name?: string;
  readonly frozen?: FrozenPanes;
  readonly query?: ViewQuery;
  /** Keyed by canonical column. */
  readonly columnOptions?: Readonly<Partial<Record<number, ColumnOptions>>>;
  readonly conditionalRules?: readonly ConditionalRule[];
}

export const hasQuery = (query?: ViewQuery): boolean =>
  !!(query?.sorts?.length || query?.filters?.length || query?.search?.trim());

export const columnOptionsAt = (
  settings: ViewSettings,
  col: CanonicalCol,
): ColumnOptions | undefined => settings.columnOptions?.[col];
