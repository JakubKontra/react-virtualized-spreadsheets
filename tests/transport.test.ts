import { describe, expect, it, vi } from 'vitest';
import { createHttpSource } from '../packages/transport/src/http';
import { RpcClient } from '../packages/transport/src/rpc';
import { FakeEventSource, FakeWorker, a, c, columns, range, rev } from './helpers';

describe('HTTP data source', () => {
  it('refetches authoritative metadata on reconnect and never rolls revisions backwards', async () => {
    const stream = new FakeEventSource();
    const meta = (revision: number) => ({
      rows: 1000000,
      columns: 50,
      revision,
      columnFormulas: { 6: '=D1*E1' },
      editableColumns: [6],
    });
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(meta(1)))
      .mockResolvedValueOnce(Response.json(meta(4)));
    const source = await createHttpSource({
      baseUrl: '/api',
      fetch: request,
      eventSource: () => stream.asEventSource(),
    });
    const events: unknown[] = [];
    source.subscribe((event) => events.push(event));
    stream.error();
    expect(events.at(-1)).toMatchObject({ connection: 'disconnected' });
    stream.message(meta(3));
    expect(source.metadata.revision).toBe(3);
    stream.message(meta(2));
    expect(source.metadata.revision).toBe(3);
    stream.open();
    await vi.waitFor(() => expect(source.metadata.revision).toBe(4));
    expect(events.at(-1)).toMatchObject({ connection: 'connected', revision: 4 });
    expect(source.isEditable(a(0, 0))).toBe(false);
    expect(source.getColumnFormula(c(6))).toBe('=D1*E1');
    source.dispose();
    expect(stream.close).toHaveBeenCalledOnce();
  });
  it('propagates rejected writes and forwards cancellation to fetch', async () => {
    const stream = new FakeEventSource();
    const request = vi
      .fn<typeof fetch>()
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
      .mockResolvedValueOnce(Response.json({ revision: 2, cells: [], range: range(0, 0, 1, 1) }));
    const source = await createHttpSource({
      baseUrl: '/api',
      fetch: request,
      eventSource: () => stream.asEventSource(),
    });
    const controller = new AbortController();
    await expect(
      source.mutate(columns({ col: c(6), formula: '=1' }), rev(1), controller.signal),
    ).rejects.toThrow('Revision conflict');
    await source.getBlock(range(0, 0, 1, 1), controller.signal);
    expect(request.mock.calls.at(-1)?.[1]?.signal).toBe(controller.signal);
    expect(source.metadata.revision).toBe(2);
    source.dispose();
  });
});
describe('worker RPC', () => {
  type Protocol = { readonly block: { readonly params: null; readonly result: string } };
  function fixture() {
    const worker = new FakeWorker();
    return { worker, rpc: new RpcClient<Protocol>(worker) };
  }
  it('ignores aborted replies without confusing a newer request', async () => {
    const { worker, rpc } = fixture();
    const controller = new AbortController();
    const first = rpc.request('block', null, controller.signal);
    controller.abort();
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    const second = rpc.request('block', null);
    worker.reply({ kind: 'reply', id: 1, ok: true, result: 'old' });
    worker.reply({ kind: 'reply', id: 2, ok: true, result: 'new' });
    await expect(second).resolves.toBe('new');
    rpc.dispose();
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.listeners.size).toBe(0);
  });
  it('rejects pending work on failure and disposal', async () => {
    const { worker, rpc } = fixture();
    const first = rpc.request('block', null);
    worker.fail('Worker failed');
    await expect(first).rejects.toThrow('Worker failed');
    await expect(rpc.request('block', null)).rejects.toThrow('Worker failed');
    rpc.dispose();
    await expect(rpc.request('block', null)).rejects.toThrow('disposed');
    const fresh = fixture();
    const pending = fresh.rpc.request('block', null);
    fresh.rpc.dispose();
    await expect(pending).rejects.toThrow('disposed');
  });
});
