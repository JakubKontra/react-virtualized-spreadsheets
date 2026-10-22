import { describe, expect, it, vi } from 'vitest';
import { createHttpSource } from '../packages/transport/src/http';
import { WorkerRpc, type RpcEndpoint } from '../packages/transport/src/rpc';

describe('HTTP data source', () => {
  it('refetches authoritative metadata on reconnect and never rolls revisions backwards', async () => {
    const stream = {
      onmessage: null as any,
      onopen: null as any,
      onerror: null as any,
      close: vi.fn(),
    };
    const meta = (revision: number) => ({
      rows: 1000000,
      columns: 50,
      revision,
      columnFormulas: { 6: '=D1*E1' },
      editableColumns: [6],
    });
    const request = vi
      .fn()
      .mockResolvedValueOnce(Response.json(meta(1)))
      .mockResolvedValueOnce(Response.json(meta(4)));
    const source = await createHttpSource({
      baseUrl: '/api',
      fetch: request,
      eventSource: () => stream as unknown as EventSource,
    });
    const events: unknown[] = [];
    source.subscribe((event) => events.push(event));
    stream.onerror();
    expect(events.at(-1)).toMatchObject({ connection: 'disconnected' });
    stream.onmessage({ data: JSON.stringify(meta(3)) });
    expect(source.metadata.revision).toBe(3);
    stream.onmessage({ data: JSON.stringify(meta(2)) });
    expect(source.metadata.revision).toBe(3);
    stream.onopen();
    await vi.waitFor(() => expect(source.metadata.revision).toBe(4));
    expect(events.at(-1)).toMatchObject({ connection: 'connected', revision: 4 });
    expect(source.isEditable({ row: 0, col: 0 })).toBe(false);
    expect(source.getColumnFormula(6)).toBe('=D1*E1');
    source.dispose();
    expect(stream.close).toHaveBeenCalledOnce();
  });
  it('propagates rejected writes and forwards cancellation to fetch', async () => {
    const stream = { close() {} } as EventSource;
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          rows: 10,
          columns: 10,
          revision: 2,
          columnFormulas: {},
          editableColumns: [6],
        }),
      )
      .mockResolvedValueOnce(Response.json({ error: 'Revision conflict' }, { status: 409 }))
      .mockResolvedValueOnce(Response.json({ revision: 2, cells: [], range: {} }));
    const source = await createHttpSource({
      baseUrl: '/api',
      fetch: request,
      eventSource: () => stream,
    });
    const controller = new AbortController();
    await expect(
      source.mutate({ columns: [{ col: 6, formula: '=1' }] }, 1, controller.signal),
    ).rejects.toThrow('Revision conflict');
    await source.getBlock(
      { start: { row: 0, col: 0 }, end: { row: 1, col: 1 } },
      controller.signal,
    );
    expect(request.mock.calls.at(-1)?.[1].signal).toBe(controller.signal);
    expect(source.metadata.revision).toBe(2);
    source.dispose();
  });
});
describe('worker RPC', () => {
  function fixture() {
    const handlers = new Map<string, (event: any) => void>();
    const worker: RpcEndpoint = {
      postMessage: vi.fn(),
      addEventListener: (type, fn) => {
        handlers.set(type, fn);
      },
      removeEventListener: (type) => {
        handlers.delete(type);
      },
      terminate: vi.fn(),
    };
    return { worker, handlers, rpc: new WorkerRpc(worker) };
  }
  it('ignores aborted replies without confusing a newer request', async () => {
    const { worker, handlers, rpc } = fixture();
    const controller = new AbortController();
    const first = rpc.request('block', {}, controller.signal);
    controller.abort();
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    const second = rpc.request('block', {});
    handlers.get('message')!({ data: { id: 1, result: 'old' } });
    handlers.get('message')!({ data: { id: 2, result: 'new' } });
    await expect(second).resolves.toBe('new');
    rpc.dispose();
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(handlers.size).toBe(0);
  });
  it('rejects pending work on failure and disposal', async () => {
    const { handlers, rpc } = fixture();
    const first = rpc.request('block', {});
    handlers.get('error')!({ message: 'Worker failed' });
    await expect(first).rejects.toThrow('Worker failed');
    await expect(rpc.request('block', {})).rejects.toThrow('Worker failed');
    rpc.dispose();
    await expect(rpc.request('block', {})).rejects.toThrow('disposed');
    const fresh = fixture();
    const pending = fresh.rpc.request('block', {});
    fresh.rpc.dispose();
    await expect(pending).rejects.toThrow('disposed');
  });
});
