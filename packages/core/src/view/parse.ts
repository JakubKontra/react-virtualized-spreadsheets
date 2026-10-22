import { SourceId, ViewId, ViewRevision } from '../brand';
import { isCellInput, isFormula, type CellInput, type Formula } from '../cell';
import { CanonicalCol, Index, parseCellKey, type AxisName, type CellKey } from '../coords';
import { SheetError } from '../errors';
import {
  CELL_KINDS,
  DEFAULT_CURRENCY,
  FILTER_OPERATORS,
  operatorTakesValue,
  type ColumnFilter,
  type ColumnOptions,
  type ColumnSort,
  type ConditionalRule,
  type FilterValue,
  type ViewQuery,
  type ViewSettings,
} from '../features';
import { LIMITS } from '../limits';
import {
  array,
  bool,
  finite,
  int,
  literal,
  map,
  object,
  optional,
  record,
  refine,
  str,
  union,
  withMessage,
  type Parser,
} from '../validate';
import { ViewAxis, type AxisSpan, type OwnedItem, type ViewAxisState } from './axis';
import type { PersistedView, SheetViewState, ViewSummary } from './state';

const NUMERIC_KEY = /^\d+$/;
const HEX_COLOR = /^#[\da-f]{6}$/i;

function settingsParsers(columns: number) {
  const col: Parser<CanonicalCol> = map(int({ min: 0, max: columns - 1 }), CanonicalCol.unsafe);
  const filterValue: Parser<FilterValue> = union(str(), finite, bool);
  const filterFields = {
    col,
    operator: literal(...FILTER_OPERATORS),
    value: optional(filterValue),
  };
  const toFilter = (raw: {
    col: CanonicalCol;
    operator: ColumnFilter['operator'];
    value?: FilterValue;
  }): ColumnFilter =>
    operatorTakesValue(raw.operator)
      ? { col: raw.col, operator: raw.operator, value: raw.value ?? '' }
      : { col: raw.col, operator: raw.operator };
  const filter: Parser<ColumnFilter> = map(object(filterFields), toFilter);
  const sort: Parser<ColumnSort> = object({ col, direction: literal('asc', 'desc') });
  const query: Parser<ViewQuery> = object({
    sorts: optional(array(sort, { max: LIMITS.maxSorts })),
    filters: optional(array(filter, { max: LIMITS.maxFilters })),
    search: optional(str({ max: LIMITS.maxSearchLength })),
  });
  const columnOptions: Parser<ColumnOptions> = map(
    object({
      kind: literal(...CELL_KINDS),
      decimals: optional(int({ min: 0, max: 10 })),
      currency: optional(str({ pattern: /^[A-Z]{3}$/ })),
      options: optional(
        array(str({ max: LIMITS.maxSelectOptionLength }), { max: LIMITS.maxSelectOptions }),
      ),
    }),
    (raw): ColumnOptions => {
      const decimals = raw.decimals === undefined ? {} : { decimals: raw.decimals };
      switch (raw.kind) {
        case 'auto':
        case 'text':
        case 'date':
        case 'checkbox':
          return { kind: raw.kind };
        case 'number':
        case 'percent':
          return { kind: raw.kind, ...decimals };
        case 'currency':
          return { kind: raw.kind, currency: raw.currency ?? DEFAULT_CURRENCY, ...decimals };
        case 'select':
          return { kind: raw.kind, options: raw.options ?? [] };
      }
    },
  );
  const rule: Parser<ConditionalRule> = map(
    object({
      ...filterFields,
      id: str(),
      color: str({ pattern: HEX_COLOR }),
      background: str({ pattern: HEX_COLOR }),
      bold: optional(bool),
    }),
    (raw): ConditionalRule => ({
      ...toFilter(raw),
      id: raw.id,
      color: raw.color,
      background: raw.background,
      ...(raw.bold === undefined ? {} : { bold: raw.bold }),
    }),
  );
  const settings: Parser<ViewSettings> = object({
    name: optional(
      withMessage(
        refine(str({ max: LIMITS.maxViewNameLength }), (name) =>
          name.trim() ? null : 'Empty name',
        ),
        'View name must contain 1–100 characters',
      ),
    ),
    frozen: optional(
      withMessage(
        object({
          rows: int({ min: 0, max: LIMITS.maxFrozenRows }),
          columns: int({ min: 0, max: LIMITS.maxFrozenColumns }),
        }),
        'Freeze up to 20 rows and 10 columns',
      ),
    ),
    query: optional(withMessage(query, 'Invalid query (maximum 3 sorts and 8 filters)')),
    columnOptions: optional(
      withMessage(
        refine(record(columnOptions, { key: NUMERIC_KEY }), (options) =>
          Object.keys(options).every((key) => Number(key) < columns) ? null : 'Unknown column',
        ),
        'Invalid column format',
      ),
    ),
    conditionalRules: optional(
      withMessage(array(rule, { max: 32 }), 'Invalid conditional formatting rule'),
    ),
  });
  return { settings };
}

/** Validates view settings for a view with `columns` canonical columns. */
export function parseViewSettings(input: unknown, columns: number): ViewSettings {
  return settingsParsers(columns).settings(input);
}
/** Throws when settings are invalid for a view with `columns` canonical columns. */
export function validateSettings(settings: ViewSettings, columns: number): void {
  parseViewSettings(settings, columns);
}

function axisParser<A extends AxisName>(name: 'rows' | 'columns'): Parser<ViewAxisState<A>> {
  const span: Parser<AxisSpan<A>> = object({
    start: map(int({ min: 0 }), Index.unsafe<A, 'canonical'>),
    count: int({ min: 1 }),
  });
  const owned: Parser<OwnedItem> = object({ id: str({ min: 1 }), label: optional(str()) });
  const shape: Parser<ViewAxisState<A>> = withMessage(
    object({
      order: array(span),
      hidden: array(span),
      sizes: record(finite, { key: NUMERIC_KEY }),
      owned: record(owned, { key: NUMERIC_KEY }),
      nextIndex: int({ min: 0 }),
    }),
    'Invalid view axis',
  );
  const minSize = name === 'rows' ? 24 : 48;
  return (input, path) => {
    const axis = shape(input, path);
    for (const span of [...axis.order, ...axis.hidden])
      if (span.start + span.count > axis.nextIndex)
        throw new SheetError('INVALID_DOCUMENT', 'Invalid axis span');
    const sorted = [...axis.order].sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i++) {
      const previous = sorted[i - 1];
      const current = sorted[i];
      if (previous && current && previous.start + previous.count > current.start)
        throw new SheetError('INVALID_DOCUMENT', 'Duplicate axis identity');
    }
    if (new ViewAxis(axis).count < 1)
      throw new SheetError('INVALID_DOCUMENT', 'Keep at least one visible row and column');
    for (const [key, size] of Object.entries(axis.sizes))
      if (size === undefined || Number(key) >= axis.nextIndex || size < minSize || size > 2000)
        throw new SheetError('INVALID_DOCUMENT', 'Invalid axis size');
    for (const key of Object.keys(axis.owned))
      if (Number(key) >= axis.nextIndex)
        throw new SheetError('INVALID_DOCUMENT', 'Invalid custom identity');
    return axis;
  };
}

const cellInput: Parser<CellInput> = (input, path = '') => {
  if (!isCellInput(input)) throw new SheetError('INVALID_DOCUMENT', `Invalid view cell (${path})`);
  return input;
};
const formulaOrNull: Parser<Formula | null> = (input) => {
  if (input === null || isFormula(input)) return input;
  throw new SheetError('INVALID_DOCUMENT', 'Invalid column formula');
};
const rowsAxis = axisParser<'row'>('rows');
const columnsAxis = axisParser<'col'>('columns');
const header = withMessage(
  object({
    schemaVersion: literal(1),
    viewId: map(str({ min: 1 }), ViewId.unsafe),
    sourceId: map(str(), SourceId.unsafe),
    revision: map(int({ min: 0 }), ViewRevision.unsafe),
  }),
  'Invalid view document',
);
const dimensions = withMessage(
  object({ sourceRows: int({ min: 1 }), sourceColumns: int({ min: 1 }) }),
  'Invalid source dimensions',
);

/** Parses and fully validates an untrusted view document. */
export const parseViewState: Parser<SheetViewState> = (input, path) => {
  const { schemaVersion, viewId, sourceId, revision } = header(input, path);
  const { sourceRows, sourceColumns } = dimensions(input, path);
  const raw = object({
    rows: rowsAxis,
    columns: columnsAxis,
    cells: withMessage(record(cellInput), 'Invalid view inputs'),
    columnFormulas: withMessage(
      record(formulaOrNull, { key: NUMERIC_KEY }),
      'Invalid column formula',
    ),
  })(input, path);
  const { rows, columns } = raw;
  if (rows.nextIndex < sourceRows || columns.nextIndex < sourceColumns)
    throw new SheetError('INVALID_DOCUMENT', 'Invalid view axis');
  const cells: Record<CellKey, CellInput> = {};
  for (const [key, value] of Object.entries(raw.cells)) {
    const address = parseCellKey(key);
    if (!address || address.row >= rows.nextIndex || address.col >= columns.nextIndex)
      throw new SheetError('INVALID_DOCUMENT', 'Invalid cell identity');
    cells[`${address.row}:${address.col}`] = value;
  }
  for (const key of Object.keys(raw.columnFormulas))
    if (Number(key) >= columns.nextIndex)
      throw new SheetError('INVALID_DOCUMENT', 'Invalid column formula');
  const settings = parseViewSettings(input, columns.nextIndex);
  return {
    ...settings,
    schemaVersion,
    viewId,
    sourceId,
    sourceRows,
    sourceColumns,
    revision,
    rows,
    columns,
    cells,
    columnFormulas: raw.columnFormulas,
  };
};

/** Asserts that a value is a valid view document. */
export function validateViewState(value: unknown): asserts value is SheetViewState {
  parseViewState(value);
}

export const parsePersistedView: Parser<PersistedView> = object({
  state: parseViewState,
  version: str(),
});
export const parseViewSummary: Parser<ViewSummary> = object({
  viewId: map(str({ min: 1 }), ViewId.unsafe),
  name: str(),
  sourceId: map(str(), SourceId.unsafe),
});
export const parseViewSummaries: Parser<ViewSummary[]> = array(parseViewSummary);
