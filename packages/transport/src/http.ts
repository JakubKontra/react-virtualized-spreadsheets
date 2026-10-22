import {
  ColumnId,
  Emitter,
  RowId,
  type ConnectionState,
  type Parser,
  type SourceEvent,
  type ViewCapability,
  type ViewCapableSource,
} from '@sheet/core';
import {
  errorFromBody,
  HTTP_ROUTES,
  parseDataBlock,
  parseRemoteMetadata,
  parseRevision,
  parseSelectionSummary,
  parseViewBlocks,
  REVISION_HEADER,
  type RemoteMetadata,
} from './protocol/http';

export interface HttpSourceOptions {
  readonly baseUrl: string;
  readonly fetch?: typeof fetch | undefined;
  readonly eventSource?: ((url: string) => EventSource) | undefined;
  readonly signal?: AbortSignal | undefined;
}

/** Reads a JSON response, turning error bodies into errors and validating success bodies. */
async function json<T>(response: Response, parser: Parser<T>): Promise<T> {
  const data: unknown = await response.json();
  if (!response.ok) throw errorFromBody(data, response.status);
  return parser(data);
}
const post = (body: unknown, signal: AbortSignal): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
  signal,
});

/** A read-mostly source served by an HTTP API with server-sent revision events. */
export async function createHttpSource(options: HttpSourceOptions): Promise<ViewCapableSource> {
  const request = options.fetch ?? globalThis.fetch;
  const base = options.baseUrl.replace(/\/$/, '');
  const url = (route: string) => `${base}${route}`;
  let metadata = await json(
    await request(url(HTTP_ROUTES.meta), { signal: options.signal ?? null }),
    parseRemoteMetadata,
  );
  const events = new Emitter<SourceEvent>();
  let disposed = false;
  let reconnectController: AbortController | null = null;
  const stream = (options.eventSource ?? ((href) => new EventSource(href)))(
    url(HTTP_ROUTES.events),
  );
  let connection: ConnectionState = 'connected';
  const emit = (event: SourceEvent) => {
    if (!disposed) events.emit(event);
  };
  const accept = (next: RemoteMetadata) => {
    if (next.revision >= metadata.revision) metadata = next;
  };
  stream.onmessage = (event: MessageEvent<string>) => {
    try {
      accept(parseRemoteMetadata(JSON.parse(event.data)));
      connection = 'connected';
      emit({ type: 'connection', revision: metadata.revision, connection });
    } catch {
      emit({ type: 'error', revision: metadata.revision, error: 'Invalid update received' });
    }
  };
  stream.onerror = () => {
    connection = 'disconnected';
    emit({ type: 'connection', revision: metadata.revision, connection });
  };
  stream.onopen = () => {
    reconnectController?.abort();
    const controller = (reconnectController = new AbortController());
    void request(url(HTTP_ROUTES.meta), { signal: controller.signal })
      .then((response) => json(response, parseRemoteMetadata))
      .then((next) => {
        if (disposed || controller.signal.aborted) return;
        accept(next);
        connection = 'connected';
        emit({ type: 'connection', revision: metadata.revision, connection });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          emit({
            type: 'connection',
            revision: metadata.revision,
            connection: 'disconnected',
            error: String(error),
          });
      });
  };
  const views: ViewCapability = {
    async query(view, signal) {
      const response = await request(url(HTTP_ROUTES.viewQuery), post({ view }, signal));
      if (!response.ok) throw errorFromBody(await response.json(), response.status);
      return {
        rows: new Uint32Array(await response.arrayBuffer()),
        revision: parseRevision(Number(response.headers.get(REVISION_HEADER)), REVISION_HEADER),
      };
    },
    async summary(view, range, signal) {
      return json(
        await request(url(HTTP_ROUTES.viewSummary), post({ view, range }, signal)),
        parseSelectionSummary,
      );
    },
    async blocks(view, ranges, signal) {
      return json(
        await request(url(HTTP_ROUTES.viewBlocks), post({ view, ranges }, signal)),
        parseViewBlocks,
      );
    },
  };
  return {
    mode: 'remote',
    get metadata() {
      return metadata;
    },
    rowId: (row) => RowId.unsafe(`sale:${row + 1}`),
    columnId: (col) => ColumnId.unsafe(`column:${col}`),
    isEditable: (address) => metadata.editableColumns.includes(address.col),
    async getBlock(range, signal) {
      const params = new URLSearchParams({
        r0: String(range.start.row),
        r1: String(range.end.row),
        c0: String(range.start.col),
        c1: String(range.end.col),
      });
      return json(await request(`${url(HTTP_ROUTES.block)}?${params}`, { signal }), parseDataBlock);
    },
    views,
    async mutate(mutation, revision, signal) {
      const result = await json(
        await request(url(HTTP_ROUTES.mutate), post({ mutation, revision }, signal)),
        parseRemoteMetadata,
      );
      accept(result);
      emit({ type: 'revision', revision: metadata.revision });
      return { revision: result.revision };
    },
    getColumnFormula: (col) => metadata.columnFormulas[col] ?? null,
    subscribe(listener) {
      const unsubscribe = events.subscribe(listener);
      listener({ type: 'connection', revision: metadata.revision, connection });
      return unsubscribe;
    },
    dispose() {
      disposed = true;
      stream.close();
      reconnectController?.abort();
      events.clear();
    },
  };
}
