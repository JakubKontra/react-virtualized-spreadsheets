import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { Worker } from 'node:worker_threads';
import {
  Address,
  errorMessage,
  LIMITS,
  parse,
  parsePersistedView,
  parseViewState,
  SheetError,
  ViewId,
  type PersistedView,
  type ViewSummary,
} from '@sheet/core';
import {
  HTTP_ROUTES,
  parseCanonicalRange,
  parseCellRange,
  parseMutationRequest,
  REVISION_HEADER,
  RpcClient,
} from '@sheet/transport';
import { workerEndpoint } from './node-rpc';
import {
  SERVER_EVENTS,
  type ServerEvents,
  type ServerProtocol,
  type WorkerOptions,
} from './protocol';

const API = '/api';
const MAX_MUTATION_BYTES = 100_000;

/** An error with an explicit HTTP status. */
class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
function statusForError(error: unknown): number {
  if (error instanceof HttpError) return error.status;
  if (error instanceof SheetError && error.code === 'REVISION_CONFLICT') return 409;
  return 400;
}

type HttpMethod = 'GET' | 'POST' | 'PUT';
type HttpResult =
  | { readonly kind: 'json'; readonly status: number; readonly body: unknown }
  | {
      readonly kind: 'binary';
      readonly headers: Readonly<Record<string, string>>;
      readonly body: Uint8Array;
    }
  /** The handler wrote the response itself (event streams). */
  | { readonly kind: 'handled' };
interface RouteContext {
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
  readonly url: URL;
  /** Path remainder after a prefix route. */
  readonly rest: string;
}
interface Route {
  readonly method: HttpMethod;
  readonly path: string;
  /** Matches `path/<rest>` instead of `path` exactly. */
  readonly prefix?: boolean;
  handle(ctx: RouteContext): Promise<HttpResult>;
}
const json = (body: unknown, status = 200): HttpResult => ({ kind: 'json', status, body });

async function readJson(
  req: IncomingMessage,
  limit: number,
  tooLarge: HttpError,
): Promise<unknown> {
  let body = '';
  for await (const chunk of req) {
    body += String(chunk);
    if (body.length > limit) throw tooLarge;
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}
const readView = (req: IncomingMessage) =>
  readJson(req, LIMITS.maxViewBytes, new HttpError(400, 'View exceeds 2 MB'));

const parseViewRequest = parse.object({ view: parseViewState });
const parseViewBlocksRequest = parse.object({
  view: parseViewState,
  ranges: parse.array(parseCanonicalRange, { max: LIMITS.maxViewRanges }),
});
const parseViewSummaryRequest = parse.object({ view: parseViewState, range: parseCellRange });
const parseSaveRequest = parse.object({
  state: parseViewState,
  expectedVersion: parse.nullable(parse.str()),
});

export async function createDemoServer(options: Partial<WorkerOptions> = {}) {
  const savedViews = new Map<ViewId, PersistedView>();
  const workerData: WorkerOptions = {
    rows: options.rows ?? 1_000_000,
    tickMs: options.tickMs ?? 4000,
  };
  const worker = new Worker(new URL('./worker.mjs', import.meta.url), { workerData });
  const rpc = new RpcClient<ServerProtocol, ServerEvents>(workerEndpoint(worker));
  const streams = new Set<ServerResponse>();
  const endStreams = () => {
    for (const stream of streams) stream.end();
    streams.clear();
  };
  const broadcast = (data: ServerEvents['metadata']) => {
    for (const stream of streams)
      if (!stream.write(`data: ${JSON.stringify(data)}\n\n`)) {
        stream.end();
        streams.delete(stream);
      }
  };
  for (const name of SERVER_EVENTS) rpc.on(name, broadcast);
  worker.on('error', endStreams);
  worker.on('exit', endStreams);
  await rpc.request('meta', null);

  const routes: readonly Route[] = [
    {
      method: 'GET',
      path: HTTP_ROUTES.views,
      async handle({ url }) {
        const sourceId = url.searchParams.get('sourceId');
        const summaries: ViewSummary[] = [...savedViews.values()]
          .filter((v) => v.state.sourceId === sourceId)
          .map((v) => ({
            viewId: v.state.viewId,
            sourceId: v.state.sourceId,
            name: v.state.name ?? v.state.viewId,
          }));
        return json(summaries);
      },
    },
    {
      method: 'GET',
      path: HTTP_ROUTES.views,
      prefix: true,
      async handle({ rest }) {
        const view = savedViews.get(ViewId.unsafe(decodeURIComponent(rest)));
        return view ? json(view) : json({ error: 'View not found' }, 404);
      },
    },
    {
      method: 'PUT',
      path: HTTP_ROUTES.views,
      prefix: true,
      async handle({ req, rest }) {
        const id = decodeURIComponent(rest);
        const { state, expectedVersion } = parseSaveRequest(await readView(req));
        if (state.viewId !== id) throw new HttpError(400, 'View ID mismatch');
        if ((savedViews.get(state.viewId)?.version ?? null) !== expectedVersion)
          return json({ error: 'View version conflict' }, 409);
        const result = parsePersistedView({ state, version: crypto.randomUUID() });
        savedViews.set(state.viewId, result);
        return json(result);
      },
    },
    {
      method: 'POST',
      path: HTTP_ROUTES.viewBlocks,
      async handle({ req }) {
        return json(await rpc.request('viewBlocks', parseViewBlocksRequest(await readView(req))));
      },
    },
    {
      method: 'POST',
      path: HTTP_ROUTES.viewSummary,
      async handle({ req }) {
        return json(await rpc.request('viewSummary', parseViewSummaryRequest(await readView(req))));
      },
    },
    {
      method: 'POST',
      path: HTTP_ROUTES.viewQuery,
      async handle({ req }) {
        const { rows, revision } = await rpc.request(
          'viewQuery',
          parseViewRequest(await readView(req)),
        );
        return {
          kind: 'binary',
          headers: { [REVISION_HEADER]: String(revision) },
          body: new Uint8Array(rows.buffer, rows.byteOffset, rows.byteLength),
        };
      },
    },
    {
      method: 'GET',
      path: HTTP_ROUTES.meta,
      async handle() {
        return json(await rpc.request('meta', null));
      },
    },
    {
      method: 'GET',
      path: HTTP_ROUTES.block,
      async handle({ url }) {
        const param = (name: string) => {
          const raw = url.searchParams.get(name);
          if (raw === null || !/^\d+$/.test(raw)) throw new HttpError(400, 'Invalid range');
          return Number(raw);
        };
        const range = {
          start: Address.unsafe(param('r0'), param('c0')),
          end: Address.unsafe(param('r1'), param('c1')),
        };
        return json(await rpc.request('block', range));
      },
    },
    {
      method: 'POST',
      path: HTTP_ROUTES.mutate,
      async handle({ req }) {
        if (!req.headers['content-type']?.startsWith('application/json'))
          return json({ error: 'Expected application/json' }, 415);
        const body = await readJson(
          req,
          MAX_MUTATION_BYTES,
          new HttpError(413, 'Request too large'),
        );
        return json(await rpc.request('mutate', parseMutationRequest(body)));
      },
    },
    {
      method: 'GET',
      path: HTTP_ROUTES.events,
      async handle({ req, res }) {
        const meta = await rpc.request('meta', null);
        if (res.destroyed) return { kind: 'handled' };
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        streams.add(res);
        res.write(`data: ${JSON.stringify(meta)}\n\n`);
        req.on('close', () => streams.delete(res));
        return { kind: 'handled' };
      },
    },
  ];

  function route(method: string | undefined, pathname: string) {
    for (const candidate of routes) {
      if (candidate.method !== method) continue;
      const path = API + candidate.path;
      if (candidate.prefix && pathname.startsWith(`${path}/`))
        return { route: candidate, rest: pathname.slice(path.length + 1) };
      if (!candidate.prefix && pathname === path) return { route: candidate, rest: '' };
    }
    return pathname.startsWith(`${API}${HTTP_ROUTES.views}/`) ? 'method' : null;
  }

  function respond(res: ServerResponse, result: HttpResult) {
    if (res.destroyed) return;
    switch (result.kind) {
      case 'json':
        res.writeHead(result.status, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        });
        res.end(JSON.stringify(result.body));
        return;
      case 'binary':
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Cache-Control': 'no-store',
          ...result.headers,
        });
        res.end(Buffer.from(result.body.buffer, result.body.byteOffset, result.body.byteLength));
        return;
      case 'handled':
        return;
    }
  }

  const server = createHttpServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      const match = route(req.method, url.pathname);
      if (match === 'method') respond(res, json({ error: 'Method not allowed' }, 405));
      else if (!match) respond(res, json({ error: 'Not found' }, 404));
      else respond(res, await match.route.handle({ req, res, url, rest: match.rest }));
    } catch (error) {
      respond(res, json({ error: errorMessage(error) }, statusForError(error)));
    }
  });
  const heartbeat = setInterval(() => {
    for (const stream of streams) stream.write(': heartbeat\n\n');
  }, 15000);
  return {
    server,
    request: rpc.request.bind(rpc),
    async close() {
      clearInterval(heartbeat);
      endStreams();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rpc.dispose();
      await worker.terminate();
    },
  };
}
