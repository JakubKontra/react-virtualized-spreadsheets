import type {
  Address,
  CellRange,
  DataBlock,
  DataSource,
  Mutation,
  SheetMetadata,
  SourceEvent,
} from '@sheet/core';

export interface RemoteMetadata extends SheetMetadata {
  columnFormulas: Record<number, string>;
  editableColumns: number[];
}
export interface HttpSourceOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  eventSource?: (url: string) => EventSource;
  signal?: AbortSignal;
}
async function json<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status})`);
  return data as T;
}
export async function createHttpSource(options: HttpSourceOptions): Promise<DataSource> {
  const request = options.fetch ?? globalThis.fetch;
  const base = options.baseUrl.replace(/\/$/, '');
  let metadata = await json<RemoteMetadata>(
    await request(`${base}/meta`, { signal: options.signal }),
  );
  const listeners = new Set<(event: SourceEvent) => void>();
  let disposed = false;
  let reconnectController: AbortController | null = null;
  const stream = (options.eventSource ?? ((url) => new EventSource(url)))(`${base}/events`);
  let connection: SourceEvent['connection'] = 'connected';
  const emit = (event: SourceEvent) => {
    if (!disposed) listeners.forEach((listener) => listener(event));
  };
  const accept = (next: RemoteMetadata) => {
    if (next.revision >= metadata.revision) metadata = next;
  };
  stream.onmessage = (event) => {
    try {
      accept(JSON.parse(event.data) as RemoteMetadata);
      connection = 'connected';
      emit({ revision: metadata.revision, connection });
    } catch {
      emit({ revision: metadata.revision, error: 'Invalid update received' });
    }
  };
  stream.onerror = () => {
    connection = 'disconnected';
    emit({ revision: metadata.revision, connection });
  };
  stream.onopen = () => {
    reconnectController?.abort();
    reconnectController = new AbortController();
    const controller = reconnectController;
    void request(`${base}/meta`, { signal: controller.signal })
      .then(json<RemoteMetadata>)
      .then((next) => {
        if (disposed || controller.signal.aborted) return;
        accept(next);
        connection = 'connected';
        emit({ revision: metadata.revision, connection });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          emit({ revision: metadata.revision, error: String(error), connection: 'disconnected' });
      });
  };
  return {
    mode: 'remote',
    get metadata() {
      return metadata;
    },
    rowId: (row) => `sale:${row + 1}`,
    columnId: (col) => `column:${col}`,
    isEditable: (address: Address) => metadata.editableColumns.includes(address.col),
    async getBlock(range: CellRange, signal: AbortSignal) {
      const params = new URLSearchParams({
        r0: String(range.start.row),
        r1: String(range.end.row),
        c0: String(range.start.col),
        c1: String(range.end.col),
      });
      return json<DataBlock>(await request(`${base}/block?${params}`, { signal }));
    },
    async getViewBlocks(view, ranges, signal) {
      return json<{ blocks: DataBlock[]; revision: number }>(
        await request(`${base}/view-blocks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ view, ranges }),
          signal,
        }),
      );
    },
    async mutate(mutation: Mutation, revision: number, signal: AbortSignal) {
      const result = await json<RemoteMetadata>(
        await request(`${base}/mutate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mutation, revision }),
          signal,
        }),
      );
      accept(result);
      emit({ revision: metadata.revision });
      return { revision: result.revision };
    },
    getColumnFormula: (col) => metadata.columnFormulas[col] ?? null,
    subscribe(listener) {
      listeners.add(listener);
      listener({ revision: metadata.revision, connection });
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      disposed = true;
      stream.close();
      reconnectController?.abort();
      listeners.clear();
    },
  };
}
