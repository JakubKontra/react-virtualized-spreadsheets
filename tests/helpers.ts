import { vi } from 'vitest';
import {
  Address,
  CanonicalCol,
  CanonicalRow,
  CellRange,
  ColIndex,
  ColumnId,
  hasViews,
  isFormula,
  parseA1,
  Revision,
  RowId,
  RowIndex,
  SheetError,
  type CalculationAdapter,
  type CanonicalAddress,
  type CellInput,
  type CellPatch,
  type ColumnFormulaPatch,
  type DataSource,
  type EngineSession,
  type Formula,
  type LogicalAddress,
  type Mutation,
  type SheetMetadata,
  type SpreadsheetStore,
  type ViewCalculationRegistry,
  type ViewBlocks,
  type ViewCapableSource,
  type ViewController,
} from '../packages/core/src';
import type { RpcEndpoint } from '../packages/transport/src/rpc';

// Coordinates. Tests build fixtures from plain numbers, so these brand without validation.
export const r = (row: number) => RowIndex.unsafe(row);
export const c = (col: number) => ColIndex.unsafe(col);
export const cr = (row: number) => CanonicalRow.unsafe(row);
export const cc = (col: number) => CanonicalCol.unsafe(col);
export const a = (row: number, col: number): Address => Address.unsafe(row, col);
export const la = (row: number, col: number): LogicalAddress => Address.unsafe<'logical'>(row, col);
export const ca = (row: number, col: number): CanonicalAddress =>
  Address.unsafe<'canonical'>(row, col);
export const range = (r0: number, c0: number, r1 = r0, c1 = c0): CellRange =>
  CellRange.unsafe(r0, c0, r1, c1);
export const crange = (r0: number, c0: number, r1 = r0, c1 = c0): CellRange<'canonical'> =>
  CellRange.unsafe<'canonical'>(r0, c0, r1, c1);
export const rev = (revision: number) => Revision.unsafe(revision);

/** Visible address of an A1 label; throws instead of returning `null`. */
export function A1(label: string): Address {
  return required(parseA1(label), `Invalid A1 label ${label}`);
}

// Mutations.
export const cell = (row: number, col: number, input: CellInput): CellPatch => ({
  ...a(row, col),
  input,
});
export const cells = (...patches: CellPatch[]): Mutation => ({ kind: 'cells', cells: patches });
export const columns = (...patches: ColumnFormulaPatch[]): Mutation => ({
  kind: 'columns',
  columns: patches,
});

export const signal = () => new AbortController().signal;

/** Narrows away `null`/`undefined`, failing the test with a message otherwise. */
export function required<T>(value: T | null | undefined, message = 'Expected a value'): T {
  if (value === null || value === undefined) throw new Error(message);
  return value;
}
/** The item at `index`, failing the test when it is missing. */
export const nth = <T>(items: readonly T[], index: number): T =>
  required(items.at(index), `Missing item ${index}`);
/** A cell input that must be a formula. */
export function formula(input: CellInput | undefined): Formula {
  if (!isFormula(input)) throw new Error(`Expected a formula, got ${String(input)}`);
  return input;
}
/** Value of the single cell of a one-cell view block request. */
export const onlyValue = (result: ViewBlocks) => nth(nth(result.blocks, 0).cells, 0).value;
export const viewOf = (store: SpreadsheetStore): ViewController =>
  required(store.view, 'Store has no view');
export function requireViews(source: DataSource): ViewCapableSource {
  if (!hasViews(source)) throw new Error('Source has no view capability');
  return source;
}

/** A calculation adapter answering directly from a session (and its view registry, if given). */
export function sessionCalculator(
  session: EngineSession,
  registry?: ViewCalculationRegistry,
): CalculationAdapter {
  return {
    calculate: async (range) => session.block(range),
    apply: async (mutation, revision) => session.mutate(mutation, revision),
    ...(registry
      ? {
          views: {
            query: async (view) => registry.query(view, session.revision),
            summary: async (view, range) => registry.summary(view, range, session.revision),
            blocks: async (view, ranges) => registry.blocks(view, ranges, session.revision),
          },
        }
      : {}),
    dispose() {},
  };
}

/** A source with the given metadata whose data methods are not expected to be called. */
export function stubSource(metadata: SheetMetadata): DataSource {
  const unused = () => {
    throw new SheetError('UNSUPPORTED', 'Not used by this test');
  };
  return {
    mode: 'remote',
    metadata,
    rowId: (row) => RowId.unsafe(String(row)),
    columnId: (col) => ColumnId.unsafe(String(col)),
    isEditable: () => false,
    getBlock: async () => unused(),
    mutate: async () => unused(),
    getColumnFormula: () => null,
    subscribe: () => () => {},
    dispose() {},
  };
}

/** The members of `EventSource` that `createHttpSource` uses, driven by the test. */
export class FakeEventSource {
  onmessage: ((event: { readonly data: string }) => void) | null = null;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();
  message(data: unknown) {
    required(this.onmessage, 'onmessage not attached')({ data: JSON.stringify(data) });
  }
  open() {
    required(this.onopen, 'onopen not attached')();
  }
  error() {
    required(this.onerror, 'onerror not attached')();
  }
  asEventSource(): EventSource {
    // Structural stand-in: only the handlers and `close` above are touched by the source.
    return this as unknown as EventSource;
  }
}

type MessageListener = (event: { readonly data: unknown }) => void;
type ErrorListener = (event: { readonly message?: string }) => void;
type AnyEvent = { readonly data: unknown; readonly message?: string };

/** An in-memory `Worker` stand-in for `RpcClient`. */
export class FakeWorker implements RpcEndpoint {
  readonly listeners = new Map<'message' | 'error', (event: AnyEvent) => void>();
  readonly posted: unknown[] = [];
  terminate = vi.fn();
  /** Forwards posted messages, for example to an in-memory `serveRpc` scope. */
  onPost: ((message: unknown) => void) | undefined;
  postMessage(message: unknown) {
    this.posted.push(message);
    this.onPost?.(message);
  }
  addEventListener(type: 'message', listener: MessageListener): void;
  addEventListener(type: 'error', listener: ErrorListener): void;
  addEventListener(type: 'message' | 'error', listener: MessageListener | ErrorListener) {
    // Every event this fake dispatches satisfies both listener shapes.
    this.listeners.set(type, (event) => listener(event));
  }
  removeEventListener(type: 'message', listener: MessageListener): void;
  removeEventListener(type: 'error', listener: ErrorListener): void;
  removeEventListener(type: 'message' | 'error') {
    this.listeners.delete(type);
  }
  /** Delivers a message as if the worker had posted it. */
  reply(data: unknown) {
    required(this.listeners.get('message'), 'No message listener')({ data });
  }
  fail(message: string) {
    required(this.listeners.get('error'), 'No error listener')({ data: undefined, message });
  }
}
