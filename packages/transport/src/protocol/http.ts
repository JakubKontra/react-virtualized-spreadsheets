import {
  Address,
  CELL_STATUSES,
  ColIndex,
  ERROR_CODES,
  isCellInput,
  isFormula,
  isRecord,
  LIMITS,
  parse,
  Revision,
  SheetError,
  type CellRange,
  type CellRecord,
  type CellStatus,
  type CellValue,
  type DataBlock,
  type Formula,
  type IndexSpace,
  type Mutation,
  type MutationResult,
  type Parser,
  type SelectionSummary,
  type SheetMetadata,
  type ViewBlocks,
} from '@sheet/core';

/** Paths relative to the API base URL, shared by the HTTP source and the demo server. */
export const HTTP_ROUTES = {
  meta: '/meta',
  events: '/events',
  block: '/block',
  mutate: '/mutate',
  viewBlocks: '/view-blocks',
  viewQuery: '/view-query',
  viewSummary: '/view-summary',
  views: '/views',
} as const;
/** Response header carrying the revision of a binary `/view-query` result. */
export const REVISION_HEADER = 'X-Sheet-Revision';

/** Metadata of a remote source: dimensions plus its calculated columns. */
export interface RemoteMetadata extends SheetMetadata {
  readonly columnFormulas: Readonly<Partial<Record<number, Formula>>>;
  readonly editableColumns: readonly ColIndex[];
}
export interface ErrorBody {
  readonly error: string;
}

const { array, finite, int, map, nullable, object, record, str } = parse;

export const parseRevision: Parser<Revision> = map(int({ min: 0 }), Revision.unsafe);
const formula: Parser<Formula> = (input, path = '') => {
  if (isFormula(input)) return input;
  throw new parse.ValidationError(path, 'Expected a formula');
};
const colIndex: Parser<ColIndex> = map(int({ min: 0 }), ColIndex.unsafe);

export const parseRemoteMetadata: Parser<RemoteMetadata> = object({
  rows: int({ min: 0 }),
  columns: int({ min: 0 }),
  revision: parseRevision,
  columnFormulas: record(formula, { key: /^\d+$/ }),
  editableColumns: array(colIndex),
});

function cellRangeParser<S extends IndexSpace>(): Parser<CellRange<S>> {
  const address: Parser<Address<S>> = map(
    object({ row: int({ min: 0 }), col: int({ min: 0 }) }),
    ({ row, col }) => Address.unsafe<S>(row, col),
  );
  return object({ start: address, end: address });
}
export const parseCellRange: Parser<CellRange> = cellRangeParser();
export const parseCanonicalRange: Parser<CellRange<'canonical'>> = cellRangeParser();

const isErrorValue = (value: unknown) =>
  isRecord(value) &&
  ERROR_CODES.some((code) => code === value['error']) &&
  typeof value['message'] === 'string';
const isStatus = (value: unknown): value is CellStatus =>
  CELL_STATUSES.some((status) => status === value);

/** Validates every cell in one pass; blocks can hold 20,000 cells. */
function blockParser<S extends IndexSpace>(): Parser<DataBlock<S>> {
  const range = cellRangeParser<S>();
  return (input, path = '') => {
    if (!isRecord(input) || !Array.isArray(input['cells']))
      throw new parse.ValidationError(path, 'Expected a data block');
    const cells: CellRecord<S>[] = [];
    for (const raw of input['cells']) {
      if (
        !isRecord(raw) ||
        !Number.isSafeInteger(raw['row']) ||
        !Number.isSafeInteger(raw['col']) ||
        !isCellInput(raw['input']) ||
        !(isCellInput(raw['value']) || isErrorValue(raw['value'])) ||
        !isStatus(raw['status'])
      )
        throw new parse.ValidationError(`${path}.cells`, 'Invalid cell');
      const message = raw['message'];
      cells.push({
        ...Address.unsafe<S>(Number(raw['row']), Number(raw['col'])),
        input: raw['input'],
        // Checked above: a cell input or a formula error.
        value: raw['value'] as CellValue,
        status: raw['status'],
        ...(typeof message === 'string' ? { message } : {}),
      });
    }
    return {
      range: range(input['range'], `${path}.range`),
      revision: parseRevision(input['revision'], `${path}.revision`),
      cells,
    };
  };
}
export const parseDataBlock: Parser<DataBlock> = blockParser();
export const parseViewBlocks: Parser<ViewBlocks> = object({
  blocks: array(blockParser<'canonical'>()),
  revision: parseRevision,
});
export const parseSelectionSummary: Parser<SelectionSummary> = object({
  count: int({ min: 0 }),
  numericCount: int({ min: 0 }),
  sum: finite,
  average: nullable(finite),
  min: nullable(finite),
  max: nullable(finite),
  revision: parseRevision,
});
export const parseMutationResult: Parser<MutationResult> = object({ revision: parseRevision });

const cellsMutation: Parser<Mutation & { kind: 'cells' }> = object({
  kind: parse.literal('cells'),
  cells: array(
    map(
      object({ row: int({ min: 0 }), col: int({ min: 0 }), input: parse.unknownValue }),
      ({ row, col, input }) => {
        if (!isCellInput(input)) throw new parse.ValidationError('input', 'Invalid cell input');
        return { ...Address.unsafe(row, col), input };
      },
    ),
    { max: LIMITS.maxEditCells },
  ),
});
const columnsMutation: Parser<Mutation & { kind: 'columns' }> = object({
  kind: parse.literal('columns'),
  columns: array(
    object({
      col: colIndex,
      formula: nullable(
        parse.refine(formula, (f) =>
          f.length > LIMITS.maxFormulaLength ? 'Formula is too long' : null,
        ),
      ),
    }),
    { max: LIMITS.maxEditCells },
  ),
});
export const parseMutation: Parser<Mutation> = parse.variant('kind', {
  cells: cellsMutation,
  columns: columnsMutation,
});
export const parseMutationRequest = object({ mutation: parseMutation, revision: parseRevision });

export const parseErrorBody: Parser<ErrorBody> = object({ error: str() });

/** The message of an error response, or a generic one. */
export function errorFromBody(body: unknown, status: number): SheetError {
  const message = isRecord(body) && typeof body['error'] === 'string' ? body['error'] : undefined;
  return new SheetError(
    status === 409 ? 'REVISION_CONFLICT' : status >= 500 ? 'REQUEST_FAILED' : 'INVALID_INPUT',
    message ?? `Request failed (${status})`,
  );
}
