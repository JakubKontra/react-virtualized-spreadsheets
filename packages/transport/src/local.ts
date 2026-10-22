import {
  EngineSession,
  ViewCalculationRegistry,
  type SheetViewState,
  type Address,
  type CalculationAdapter,
  type CellRange,
  type DataBlock,
  type DataSource,
  type Mutation,
  type SheetMetadata,
  type SourceEvent,
} from '@sheet/core';
import { WorkerRpc, type RpcEndpoint, type RpcRequest } from './rpc';

export class WorkerCalculationAdapter implements CalculationAdapter {
  readonly rpc: WorkerRpc;
  constructor(worker: RpcEndpoint) {
    this.rpc = new WorkerRpc(worker);
  }
  calculate(range: CellRange, signal: AbortSignal) {
    return this.rpc.request<DataBlock>('block', range, signal);
  }
  calculateView(view: SheetViewState, ranges: CellRange[], signal: AbortSignal) {
    return this.rpc.request<{ blocks: DataBlock[]; revision: number }>(
      'viewBlocks',
      { view, ranges },
      signal,
    );
  }
  apply(mutation: Mutation, revision: number, signal: AbortSignal) {
    return this.rpc.request<{ revision: number }>('mutate', { mutation, revision }, signal);
  }
  dispose() {
    this.rpc.dispose();
  }
}
export interface LocalSourceOptions {
  metadata: SheetMetadata;
  calculator: CalculationAdapter;
  columnFormulas?: Record<number, string>;
  editable?: (address: Address) => boolean;
}
export function createLocalSource(options: LocalSourceOptions): DataSource {
  let metadata = options.metadata;
  const formulas = new Map(
    Object.entries(options.columnFormulas ?? {}).map(([col, formula]) => [Number(col), formula]),
  );
  const listeners = new Set<(event: SourceEvent) => void>();
  return {
    mode: 'local',
    get metadata() {
      return metadata;
    },
    rowId: (row) => `row:${row}`,
    columnId: (col) => `column:${col}`,
    isEditable: (address) => options.editable?.(address) ?? true,
    getBlock: (range, signal) => options.calculator.calculate(range, signal),
    getViewBlocks: options.calculator.calculateView
      ? (view, ranges, signal) => options.calculator.calculateView!(view, ranges, signal)
      : undefined,
    async mutate(mutation, revision, signal) {
      const result = await options.calculator.apply(mutation, revision, signal);
      metadata = { ...metadata, revision: result.revision };
      for (const column of mutation.columns ?? []) {
        if (column.formula === null) formulas.delete(column.col);
        else formulas.set(column.col, column.formula);
      }
      listeners.forEach((listener) => listener({ revision: result.revision }));
      return result;
    },
    getColumnFormula: (col) => formulas.get(col) ?? null,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      listeners.clear();
      options.calculator.dispose();
    },
  };
}
/** Install inside an application-owned browser worker; the application supplies its initial data. */
export function installCalculationWorker(
  session: EngineSession,
  scope: {
    onmessage: ((event: MessageEvent<RpcRequest>) => void) | null;
    postMessage(message: unknown): void;
  },
) {
  const views = new ViewCalculationRegistry(session.engine);
  scope.onmessage = (event) => {
    const { id, method, payload } = event.data;
    try {
      let result: unknown;
      if (method === 'block') result = session.block(payload as CellRange);
      else if (method === 'viewBlocks') {
        const data = payload as { view: SheetViewState; ranges: CellRange[] };
        result = views.blocks(data.view, data.ranges, session.revision);
      } else if (method === 'mutate') {
        const data = payload as { mutation: Mutation; revision: number };
        result = session.mutate(data.mutation, data.revision);
      } else throw new Error('Unknown worker method');
      scope.postMessage({ id, result });
    } catch (error) {
      scope.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
    }
  };
}
