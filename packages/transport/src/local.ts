import {
  ColIndex,
  ColumnId,
  Emitter,
  RowId,
  type Address,
  type CalculationAdapter,
  type CellRange,
  type DataSource,
  type EngineSession,
  type Formula,
  type Mutation,
  type Revision,
  type SheetMetadata,
  type SourceEvent,
  type ViewCapability,
  type ViewCapableSource,
} from '@sheet/core';
import { createCalculationHandlers, type CalculationProtocol } from './protocol/calculation';
import { RpcClient, serveRpc, type RpcEndpoint, type RpcScope } from './rpc';

/** Runs calculations in a worker created by the application. */
export class WorkerCalculationAdapter implements CalculationAdapter {
  readonly rpc: RpcClient<CalculationProtocol>;
  readonly views: ViewCapability;
  constructor(worker: RpcEndpoint) {
    const rpc = (this.rpc = new RpcClient<CalculationProtocol>(worker));
    this.views = {
      query: (view, signal) => rpc.request('viewQuery', { view }, signal),
      summary: (view, range, signal) => rpc.request('viewSummary', { view, range }, signal),
      blocks: (view, ranges, signal) => rpc.request('viewBlocks', { view, ranges }, signal),
    };
  }
  calculate(range: CellRange, signal: AbortSignal) {
    return this.rpc.request('block', range, signal);
  }
  apply(mutation: Mutation, revision: Revision, signal: AbortSignal) {
    return this.rpc.request('mutate', { mutation, revision }, signal);
  }
  dispose() {
    this.rpc.dispose();
  }
}

export interface LocalSourceOptions<C extends CalculationAdapter = CalculationAdapter> {
  readonly metadata: SheetMetadata;
  readonly calculator: C;
  /** Formulas of calculated columns, keyed by column. */
  readonly columnFormulas?: Readonly<Partial<Record<number, Formula>>> | undefined;
  readonly editable?: ((address: Address) => boolean) | undefined;
}

/** A source with view support exactly when its calculator has it. */
export type LocalSource<C extends CalculationAdapter> = C extends {
  readonly views: ViewCapability;
}
  ? ViewCapableSource
  : DataSource;

/** A source whose complete data lives in this browser (usually behind a worker). */
export function createLocalSource<C extends CalculationAdapter>(
  options: LocalSourceOptions<C>,
): LocalSource<C>;
export function createLocalSource(options: LocalSourceOptions): DataSource {
  let metadata = options.metadata;
  const formulas = new Map<ColIndex, Formula>();
  for (const [col, formula] of Object.entries(options.columnFormulas ?? {}))
    if (formula !== undefined) formulas.set(ColIndex.unsafe(Number(col)), formula);
  const events = new Emitter<SourceEvent>();
  const { calculator } = options;
  return {
    mode: 'local',
    get metadata() {
      return metadata;
    },
    rowId: (row) => RowId.unsafe(`row:${row}`),
    columnId: (col) => ColumnId.unsafe(`column:${col}`),
    isEditable: (address) => options.editable?.(address) ?? true,
    getBlock: (range, signal) => calculator.calculate(range, signal),
    ...(calculator.views ? { views: calculator.views } : {}),
    async mutate(mutation, revision, signal) {
      const result = await calculator.apply(mutation, revision, signal);
      metadata = { ...metadata, revision: result.revision };
      if (mutation.kind === 'columns')
        for (const column of mutation.columns) {
          if (column.formula === null) formulas.delete(column.col);
          else formulas.set(column.col, column.formula);
        }
      events.emit({ type: 'revision', revision: result.revision });
      return result;
    },
    getColumnFormula: (col) => formulas.get(col) ?? null,
    subscribe: events.subscribe,
    dispose() {
      events.clear();
      calculator.dispose();
    },
  };
}

/** Install inside an application-owned browser worker; the application supplies its initial data. */
export function installCalculationWorker(session: EngineSession, scope: RpcScope) {
  return serveRpc<CalculationProtocol>(scope, createCalculationHandlers(session));
}
