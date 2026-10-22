import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDemoServer } from '../apps/server/src/server';
import { createSalesEngine } from '../apps/shared/sales';

describe('demo server', () => {
  let app: Awaited<ReturnType<typeof createDemoServer>>;
  let base: string;
  beforeAll(async () => {
    app = await createDemoServer({ rows: 1000000, tickMs: 0 });
    await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
    const address = app.server.address();
    base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/api`;
  });
  afterAll(async () => {
    await app?.close();
  });
  it('matches local calculations at arbitrary offsets', async () => {
    const block = await (await fetch(`${base}/block?r0=999995&r1=999999&c0=3&c1=7`)).json();
    const local = createSalesEngine(1000000);
    expect(block).toEqual(
      local.block({ start: { row: 999995, col: 3 }, end: { row: 999999, col: 7 } }, 0),
    );
  });
  it('calculates unseen rows and rejects conflicting writes', async () => {
    const result = await fetch(`${base}/mutate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        revision: 0,
        mutation: { columns: [{ col: 8, formula: '=SUM($D$1:$D$1000000)' }] },
      }),
    });
    expect(result.status).toBe(200);
    const block = await (await fetch(`${base}/block?r0=0&r1=0&c0=8&c1=8`)).json();
    expect(block.cells[0].value).toBe(4999996);
    const stale = await fetch(`${base}/mutate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision: 0, mutation: { columns: [{ col: 8, formula: '=1' }] } }),
    });
    expect(stale.status).toBe(409);
  });
  it('rejects source writes, malformed formulas and oversized reads', async () => {
    await expect(
      app.request('mutate', { revision: 1, mutation: { columns: [{ col: 0, formula: '=2' }] } }),
    ).rejects.toThrow('read-only');
    await expect(
      app.request('mutate', { revision: 1, mutation: { columns: [{ col: 8, formula: '=1+' }] } }),
    ).rejects.toThrow();
    expect((await fetch(`${base}/block?r0=0&r1=10000&c0=0&c1=49`)).status).toBe(400);
  });
  it('streams revisions and recalculates aggregates after upstream changes', async () => {
    const controller = new AbortController();
    const response = await fetch(`${base}/events`, { signal: controller.signal });
    const reader = response.body!.getReader();
    const initial = new TextDecoder().decode((await reader.read()).value);
    expect(initial).toContain('"revision":1');
    await app.request('tick');
    const update = new TextDecoder().decode((await reader.read()).value);
    expect(update).toContain('"revision":2');
    const block = await (await fetch(`${base}/block?r0=0&r1=0&c0=8&c1=8`)).json();
    expect(block.cells[0].value).toBe(4999998);
    controller.abort();
    await reader.cancel().catch(() => {});
  });
});
