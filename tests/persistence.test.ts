import { describe, expect, it } from 'vitest';
import {
  ViewController,
  type SheetViewState,
  type PersistedView,
  type ViewPersistenceAdapter,
} from '../packages/core/src';
import {
  HttpViewAdapter,
  LocalStorageViewAdapter,
  ViewPersistenceBinding,
} from '../packages/transport/src/persistence';
const initial = (): SheetViewState => ({
  schemaVersion: 1,
  viewId: 'mine',
  sourceId: 'sales',
  sourceRows: 1000000,
  sourceColumns: 50,
  revision: 0,
  rows: {
    order: [{ start: 0, count: 1000000 }],
    hidden: [],
    sizes: {},
    owned: {},
    nextIndex: 1000000,
  },
  columns: { order: [{ start: 0, count: 50 }], hidden: [], sizes: {}, owned: {}, nextIndex: 50 },
  cells: {},
  columnFormulas: {},
});
const signal = () => new AbortController().signal;
function storage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

describe('view persistence', () => {
  it('roundtrips compact state and rejects stale versions and aborted requests', async () => {
    const memory = storage();
    const adapter = new LocalStorageViewAdapter(memory);
    expect(await adapter.load('mine', signal())).toBe(null);
    const view = new ViewController(initial());
    view.change({ type: 'insert', axis: 'rows', before: 10 });
    view.change({ type: 'resize', axis: 'rows', start: 10, count: 1, size: 90 });
    const saved = await adapter.save(view.getSnapshot(), null, signal());
    expect(await new LocalStorageViewAdapter(memory).load('mine', signal())).toEqual(saved);
    await expect(adapter.save(view.getSnapshot(), null, signal())).rejects.toThrow('another tab');
    const controller = new AbortController();
    controller.abort();
    await expect(adapter.load('mine', controller.signal)).rejects.toThrow();
    await expect(
      adapter.save(view.getSnapshot(), saved.version, controller.signal),
    ).rejects.toThrow();
    const races = await Promise.allSettled([
      adapter.save(view.getSnapshot(), saved.version, signal()),
      adapter.save(view.getSnapshot(), saved.version, signal()),
    ]);
    expect(races.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  });
  it('serializes saves and includes edits made while a request is in flight', async () => {
    const requests: {
      state: SheetViewState;
      expected: string | null;
      resolve: (result: PersistedView) => void;
    }[] = [];
    const adapter: ViewPersistenceAdapter = {
      async load() {
        return null;
      },
      save(state, expected) {
        return new Promise((resolve) => requests.push({ state, expected, resolve }));
      },
    };
    const view = new ViewController(initial());
    const binding = new ViewPersistenceBinding(view, adapter, null, 10000);
    view.change({ type: 'hide', axis: 'rows', start: 5, count: 10 });
    const flight = binding.flush();
    expect(requests).toHaveLength(1);
    view.change({ type: 'move', axis: 'columns', start: 0, count: 1, before: 3 });
    expect(binding.flush()).toBe(flight);
    expect(requests).toHaveLength(1);
    requests[0].resolve({ state: requests[0].state, version: 'v1' });
    await Promise.resolve();
    expect(requests).toHaveLength(2);
    expect(requests[1].expected).toBe('v1');
    expect(requests[1].state.revision).toBe(2);
    requests[1].resolve({ state: requests[1].state, version: 'v2' });
    await flight;
    expect(binding.getSnapshot().status).toBe('saved');
    binding.dispose();
  });
  it('keeps local state on failure, retries explicitly and aborts outstanding saves on dispose', async () => {
    const view = new ViewController(initial());
    let fail = true;
    let aborted: AbortSignal | undefined;
    const adapter: ViewPersistenceAdapter = {
      async load() {
        return null;
      },
      async save(state, _version, signal) {
        aborted = signal;
        if (fail) throw new Error('Offline');
        return { state, version: 'v1' };
      },
    };
    const binding = new ViewPersistenceBinding(view, adapter, null, 10000);
    view.change({ type: 'hide', axis: 'columns', start: 0, count: 1 });
    await binding.flush();
    expect(binding.getSnapshot()).toEqual({ status: 'error', error: 'Offline' });
    expect(view.columns.count).toBe(49);
    fail = false;
    await binding.flush();
    expect(binding.getSnapshot().status).toBe('saved');
    binding.dispose();
    expect(aborted!.aborted).toBe(true);
  });
  it('rejects malformed persisted documents instead of silently resetting them', async () => {
    const memory = storage();
    const adapter = new LocalStorageViewAdapter(memory);
    memory.setItem(
      'ledger:view:mine',
      JSON.stringify({ state: { ...initial(), schemaVersion: 999 }, version: 'v1' }),
    );
    await expect(adapter.load('mine', signal())).rejects.toThrow('Invalid');
    memory.setItem(
      'ledger:view:mine',
      JSON.stringify({ state: { ...initial(), viewId: 'someone-else' }, version: 'v1' }),
    );
    await expect(adapter.load('mine', signal())).rejects.toThrow('Invalid');
  });
  it('uses the versioned HTTP contract and surfaces conflicts', async () => {
    const requests: [string, RequestInit | undefined][] = [];
    let status = 200;
    const adapter = new HttpViewAdapter('/api/views', (async (url, init) => {
      requests.push([String(url), init]);
      return new Response(JSON.stringify({ state: initial(), version: 'v1' }), { status });
    }) as typeof fetch);
    expect((await adapter.save(initial(), null, signal())).version).toBe('v1');
    expect(requests[0][0]).toBe('/api/views/mine');
    expect(JSON.parse(requests[0][1]!.body as string).expectedVersion).toBe(null);
    status = 409;
    await expect(adapter.save(initial(), 'v1', signal())).rejects.toThrow('changed on the server');
    status = 404;
    expect(await adapter.load('mine', signal())).toBe(null);
  });
});
