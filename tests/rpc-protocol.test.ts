import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { SheetError, type SheetErrorCode } from '../packages/core/src';
import { RpcClient, serveRpc, type RpcScope } from '../packages/transport/src/rpc';
import type { Handlers } from '../packages/transport/src/protocol/core';
import { FakeWorker } from './helpers';

type Protocol = {
  readonly add: {
    readonly params: { readonly a: number; readonly b: number };
    readonly result: number;
  };
  readonly fail: { readonly params: SheetErrorCode | 'plain'; readonly result: never };
};
type Events = { readonly tick: { readonly n: number } };

const handlers: Handlers<Protocol> = {
  add: ({ a, b }) => a + b,
  fail(code) {
    if (code === 'plain') throw new Error('plain failure');
    throw new SheetError(code, 'boom');
  },
};

/** Settles queued channel deliveries and handler promises. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Connects a client and a server through an asynchronous, structured-cloning in-memory channel. */
function connect() {
  const worker = new FakeWorker();
  const serverListeners: ((event: { readonly data: unknown }) => void)[] = [];
  const fromServer: unknown[] = [];
  const toServer = (data: unknown) => {
    for (const listener of serverListeners) listener({ data });
  };
  const scope: RpcScope = {
    addEventListener: (_type, listener) => {
      serverListeners.push(listener);
    },
    postMessage(message) {
      fromServer.push(message);
      const data = structuredClone(message);
      queueMicrotask(() => worker.listeners.get('message')?.({ data }));
    },
  };
  worker.onPost = (message) => {
    const data = structuredClone(message);
    queueMicrotask(() => toServer(data));
  };
  const server = serveRpc<Protocol, Events>(scope, handlers);
  const client = new RpcClient<Protocol, Events>(worker);
  return { worker, server, client, fromServer, toServer };
}

describe('RPC protocol', () => {
  it('round-trips typed requests', async () => {
    const { client, worker } = connect();
    const sum = client.request('add', { a: 2, b: 3 });
    expectTypeOf(sum).resolves.toEqualTypeOf<number>();
    await expect(sum).resolves.toBe(5);
    expect(worker.posted).toEqual([
      { kind: 'request', id: 1, method: 'add', params: { a: 2, b: 3 } },
    ]);
    const misuse = () => {
      // @ts-expect-error params must match the method
      void client.request('add', { a: '2', b: 3 });
      // @ts-expect-error unknown method
      void client.request('subtract', { a: 2, b: 3 });
    };
    void misuse;
    client.dispose();
  });
  it('ignores requests for unknown or inherited methods', async () => {
    const { client, fromServer, toServer } = connect();
    toServer({ kind: 'request', id: 99, method: 'subtract', params: null });
    toServer({ kind: 'request', id: 98, method: 'toString', params: null });
    toServer({ kind: 'request', id: 'x', method: 'add', params: { a: 1, b: 1 } });
    toServer({ kind: 'event', name: 'add', data: null });
    await flush();
    expect(fromServer).toEqual([]);
    await expect(client.request('add', { a: 1, b: 1 })).resolves.toBe(2);
    expect(fromServer).toEqual([{ kind: 'reply', id: 1, ok: true, result: 2 }]);
    client.dispose();
  });
  it('ignores malformed replies and settles on the first valid one', async () => {
    const worker = new FakeWorker();
    const client = new RpcClient<Protocol>(worker);
    const settled = vi.fn();
    const pending = client.request('add', { a: 1, b: 2 });
    pending.then(settled, settled);
    for (const malformed of [
      null,
      'reply',
      { kind: 'reply', id: 1 },
      { kind: 'reply', id: 1, ok: true },
      { kind: 'reply', id: '1', ok: true, result: 3 },
      { kind: 'reply', id: 1, ok: false, error: { code: 'NOT_A_CODE', message: 'x' } },
      { kind: 'reply', id: 1, ok: false, error: 'boom' },
      { kind: 'request', id: 1, method: 'add', params: { a: 1, b: 2 } },
    ])
      worker.reply(malformed);
    await flush();
    expect(settled).not.toHaveBeenCalled();
    worker.reply({ kind: 'reply', id: 1, ok: true, result: 3 });
    await expect(pending).resolves.toBe(3);
    client.dispose();
  });
  it('preserves SheetError codes across the channel', async () => {
    const { client } = connect();
    const error: unknown = await client.request('fail', 'READ_ONLY').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SheetError);
    expect(error).toMatchObject({ code: 'READ_ONLY', message: 'boom' });
    const plain: unknown = await client.request('fail', 'plain').catch((e: unknown) => e);
    expect(plain).toBeInstanceOf(Error);
    expect(plain).not.toBeInstanceOf(SheetError);
    expect(plain).toMatchObject({ message: 'plain failure' });
    // The channel stays usable after handler errors.
    await expect(client.request('add', { a: 4, b: 5 })).resolves.toBe(9);
    client.dispose();
  });
  it('delivers pushed events to subscribed listeners only', async () => {
    const { client, server } = connect();
    server.emit('tick', { n: 0 });
    await flush();
    const listener = vi.fn<(data: Events['tick']) => void>();
    const unsubscribe = client.on('tick', listener);
    server.emit('tick', { n: 1 });
    server.emit('tick', { n: 2 });
    await flush();
    expect(listener.mock.calls).toEqual([[{ n: 1 }], [{ n: 2 }]]);
    unsubscribe();
    server.emit('tick', { n: 3 });
    await flush();
    expect(listener).toHaveBeenCalledTimes(2);
    client.dispose();
  });
});
