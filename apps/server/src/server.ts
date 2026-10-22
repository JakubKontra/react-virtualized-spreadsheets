import { createServer as createHttpServer, type ServerResponse } from 'node:http';
import { Worker } from 'node:worker_threads';

export async function createDemoServer(options: { rows?: number; tickMs?: number } = {}) {
  const worker = new Worker(new URL('./worker.mjs', import.meta.url), {
    workerData: { rows: options.rows ?? 1000000, tickMs: options.tickMs ?? 4000 },
  });
  const streams = new Set<ServerResponse>();
  let nextId = 0;
  let workerFailure: Error | null = null;
  const pending = new Map<
    number,
    { resolve: (data: any) => void; reject: (error: Error) => void }
  >();
  const request = (method: string, payload?: unknown) =>
    new Promise<any>((resolve, reject) => {
      if (workerFailure) {
        reject(workerFailure);
        return;
      }
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, method, payload });
    });
  worker.on('message', (message) => {
    if (message.event) {
      for (const stream of streams) {
        if (!stream.write(`data: ${JSON.stringify(message.event)}\n\n`)) {
          stream.end();
          streams.delete(stream);
        }
      }
      return;
    }
    const job = pending.get(message.id);
    if (!job) return;
    pending.delete(message.id);
    if (message.error) job.reject(new Error(message.error));
    else job.resolve(message.result);
  });
  const fail = (error: Error) => {
    workerFailure = error;
    for (const job of pending.values()) job.reject(error);
    pending.clear();
    for (const stream of streams) stream.end();
    streams.clear();
  };
  worker.on('error', fail);
  worker.on('exit', (code) => fail(new Error(`Calculation worker exited (${code})`)));
  await request('meta');
  const server = createHttpServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const send = (status: number, data: unknown) => {
      if (!res.destroyed) {
        res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(data));
      }
    };
    try {
      if (url.pathname === '/api/meta' && req.method === 'GET') send(200, await request('meta'));
      else if (url.pathname === '/api/block' && req.method === 'GET') {
        const param = (name: string) => {
          const raw = url.searchParams.get(name);
          if (raw === null || !/^\d+$/.test(raw)) throw new Error('Invalid range');
          return Number(raw);
        };
        const range = {
          start: { row: param('r0'), col: param('c0') },
          end: { row: param('r1'), col: param('c1') },
        };
        send(200, await request('block', range));
      } else if (url.pathname === '/api/mutate' && req.method === 'POST') {
        if (!req.headers['content-type']?.startsWith('application/json')) {
          send(415, { error: 'Expected application/json' });
          return;
        }
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 100000) {
            send(413, { error: 'Request too large' });
            return;
          }
        }
        send(200, await request('mutate', JSON.parse(body)));
      } else if (url.pathname === '/api/events' && req.method === 'GET') {
        const meta = await request('meta');
        if (res.destroyed) return;
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        streams.add(res);
        res.write(`data: ${JSON.stringify(meta)}\n\n`);
        req.on('close', () => streams.delete(res));
      } else send(404, { error: 'Not found' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed';
      send(message.startsWith('Revision conflict') ? 409 : 400, { error: message });
    }
  });
  const heartbeat = setInterval(() => {
    for (const stream of streams) stream.write(': heartbeat\n\n');
  }, 15000);
  return {
    server,
    request,
    async close() {
      clearInterval(heartbeat);
      for (const stream of streams) stream.end();
      streams.clear();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await worker.terminate();
    },
  };
}
