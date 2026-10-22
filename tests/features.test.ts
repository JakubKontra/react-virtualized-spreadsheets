import { describe, expect, it } from 'vitest';
import {
  createFillPatches,
  createSpreadsheet,
  createViewState,
  EngineSession,
  FormulaEngine,
  formatCellValue,
  matchesFilter,
  parseTypedInput,
  ViewCalculationRegistry,
  type SheetViewState,
} from '../packages/core/src';
import { createLocalSource } from '../packages/transport/src/local';
import { LocalStorageViewAdapter } from '../packages/transport/src/persistence';
function fixture(rows = 2000) {
  const engine = new FormulaEngine({
    rows,
    columns: 5,
    readInput: ({ row, col }) =>
      col === 0 ? row + 1 : col === 1 ? row % 3 : col === 2 ? `group-${row % 2}` : null,
  });
  const session = new EngineSession(engine),
    registry = new ViewCalculationRegistry(engine);
  const source = createLocalSource({
    metadata: session.metadata,
    calculator: {
      async calculate(range) {
        return session.block(range);
      },
      async calculateView(view, ranges) {
        return registry.blocks(view, ranges, session.revision);
      },
      async queryView(view) {
        return registry.query(view, session.revision);
      },
      async summarizeView(view, range) {
        return registry.summary(view, range, session.revision);
      },
      async apply(mutation, revision) {
        return session.mutate(mutation, revision);
      },
      dispose() {},
    },
  });
  const view = createViewState(source, { viewId: 'features', sourceId: 'fixture' }),
    store = createSpreadsheet({ source, viewState: view });
  return { store, registry, view, engine, session, source };
}
async function ready(store: ReturnType<typeof fixture>['store']) {
  await expect.poll(() => store.getSnapshot().querying).toBe(false);
}
const range = (r0: number, r1: number, c0 = 0, c1 = c0) => ({
  start: { row: r0, col: c0 },
  end: { row: r1, col: c1 },
});
describe('full dataset queries and summaries', () => {
  it('filters unloaded rows, sorts by multiple columns and preserves logical formula references', async () => {
    const { store } = fixture();
    store.configure({
      query: {
        filters: [{ col: 0, operator: 'gte', value: 1990 }],
        sorts: [
          { col: 1, direction: 'asc' },
          { col: 0, direction: 'desc' },
        ],
      },
    });
    await ready(store);
    expect(store.rows).toBe(11);
    await store.ensureRange(range(0, 10, 0, 2));
    expect(store.readCell({ row: 0, col: 0 }).value).toBe(1999);
    expect(store.labelAddress({ row: 0, col: 0 })).toBe('A1999');
    expect(store.resolveAddress('A1999')).toEqual({ row: 0, col: 0 });
    expect(() =>
      store.changeView({ type: 'move', axis: 'rows', start: 0, count: 1, before: 2 }),
    ).toThrow('Clear sorting');
    await store.edit([{ row: 0, col: 0, input: 9999 }]);
    await ready(store);
    expect(store.view!.getSnapshot().cells['1998:0']).toBe(9999);
    await store.undo();
    await ready(store);
    expect(store.rows).toBe(11);
    store.dispose();
  });
  it('returns an empty result, recovers with undo and ignores superseded results', async () => {
    const { store } = fixture();
    store.configure({ query: { search: 'no such value' } });
    await ready(store);
    expect(store.rows).toBe(0);
    expect(store.source.isEditable({ row: 0, col: 0 })).toBe(false);
    await store.undo();
    await ready(store);
    expect(store.rows).toBe(2000);
    store.configure({ query: { search: 'missing' } });
    store.configure({ query: { filters: [{ col: 0, operator: 'equals', value: 2000 }] } });
    await ready(store);
    expect(store.rows).toBe(1);
    expect(store.labelAddress({ row: 0, col: 0 })).toBe('A2000');
    store.dispose();
  });
  it('keeps an edited record attached to its identity when live sorting moves it', async () => {
    const { store, source } = fixture();
    store.configure({ query: { sorts: [{ col: 0, direction: 'desc' }] } });
    await ready(store);
    await store.ensureRange(range(0, 0, 0, 4));
    store.select({ row: 0, col: 3 });
    store.beginEdit(undefined, '=A2000');
    await source.mutate(
      { cells: [{ row: 1999, col: 0, input: 0 }] },
      0,
      new AbortController().signal,
    );
    await ready(store);
    expect(store.getSnapshot().editing).toEqual({ row: 1999, col: 3 });
    expect(store.getSnapshot().draft).toBe('=A2000');
    expect(store.labelAddress(store.getSnapshot().editing!)).toBe('D2000');
    const unsubscribe = store.subscribe(() => {
      if (store.getSnapshot().querying && store.getSnapshot().editing) store.cancelEdit();
    });
    await source.mutate(
      { cells: [{ row: 1999, col: 0, input: 2000 }] },
      1,
      new AbortController().signal,
    );
    await ready(store);
    expect(store.getSnapshot().editing).toBeNull();
    expect(store.getSnapshot().draft).toBeNull();
    unsubscribe();
    store.dispose();
  });
  it('retains a filtered-out draft in an error instead of writing it into another record', async () => {
    const { store, source } = fixture();
    store.configure({
      query: {
        filters: [{ col: 0, operator: 'gte', value: 1999 }],
        sorts: [{ col: 0, direction: 'desc' }],
      },
    });
    await ready(store);
    await store.ensureRange(range(0, 1, 0, 4));
    store.select({ row: 0, col: 3 });
    store.beginEdit(undefined, '=A2000');
    await source.mutate(
      { cells: [{ row: 1999, col: 0, input: 0 }] },
      0,
      new AbortController().signal,
    );
    await ready(store);
    expect(store.rows).toBe(1);
    expect(store.getSnapshot().editing).toBeNull();
    expect(store.getSnapshot().error).toContain('Unsaved draft: =A2000');
    expect(store.view!.getSnapshot().cells).toEqual({});
    store.dispose();
  });
  it('summarizes the complete filtered selection and invalidates after an upstream revision', async () => {
    const { registry, view, session } = fixture();
    const filtered = {
      ...view,
      query: { filters: [{ col: 0, operator: 'gt' as const, value: 1990 }] },
    };
    const summary = registry.summary(filtered, range(0, 9), 0);
    expect(summary).toMatchObject({
      count: 10,
      numericCount: 10,
      sum: 19955,
      average: 1995.5,
      min: 1991,
      max: 2000,
    });
    session.mutate({ cells: [{ row: 1999, col: 0, input: 10000 }] }, 0);
    expect(registry.summary(filtered, range(0, 9), 1).sum).toBe(27955);
  });
});
describe('autofill and formats', () => {
  it('extends linear sequences in both directions, dates, and mixed formula anchors', () => {
    const values = [10, 15];
    expect(
      createFillPatches(range(2, 3), range(0, 5), (a) => values[a.row - 2]).map((p) => p.input),
    ).toEqual([0, 5, 20, 25]);
    expect(
      createFillPatches(range(0, 0), range(0, 2), () => '2024-02-28').map((p) => p.input),
    ).toEqual(['2024-02-29', '2024-03-01']);
    expect(createFillPatches(range(0, 0), range(0, 1), () => '=$A1+B$2+$C$3')[0].input).toBe(
      '=$A2+B$2+$C$3',
    );
    expect(() => createFillPatches(range(0, 0), range(0, 2, 0, 2), () => 1)).toThrow(
      'one direction',
    );
  });
  it('applies a fill as one undo and rejects invalid typed batches atomically', async () => {
    const { store } = fixture();
    await store.ensureRange(range(0, 8));
    await store.fill(range(0, 8), range(0, 1));
    expect(store.view!.getSnapshot().cells['8:0']).toBe(9);
    await store.undo();
    expect(store.view!.getSnapshot().cells).toEqual({});
    store.configure({ columnOptions: { 0: { kind: 'number' } } });
    await store.ensureRange(range(0, 1));
    await expect(
      store.edit([
        { row: 0, col: 0, input: 4 },
        { row: 1, col: 0, input: 'bad' },
      ]),
    ).rejects.toThrow('valid number');
    expect(store.view!.getSnapshot().cells).toEqual({});
    store.dispose();
  });
  it('parses percentages and text, formats currency and matches conditions on raw values', () => {
    expect(parseTypedInput('25%', { kind: 'percent' })).toBe(0.25);
    expect(parseTypedInput('0012', { kind: 'text' })).toBe('0012');
    expect(formatCellValue(0.25, { kind: 'percent', decimals: 1 })).toBe('25.0%');
    expect(formatCellValue(12, { kind: 'currency', currency: 'EUR', decimals: 2 }, 'en-US')).toBe(
      '€12.00',
    );
    expect(matchesFilter(-0.1, { col: 0, operator: 'lt', value: 0 })).toBe(true);
    expect(matchesFilter(null, { col: 0, operator: 'lt', value: 0 })).toBe(false);
    expect(matchesFilter('', { col: 0, operator: 'empty' })).toBe(true);
  });
  it('saves names, formats and frozen panes independently in the catalog', async () => {
    const data = new Map<string, string>(),
      adapter = new LocalStorageViewAdapter({
        getItem: (k) => data.get(k) ?? null,
        setItem: (k, v) => {
          data.set(k, v);
        },
      }),
      signal = new AbortController().signal;
    const { view, store } = fixture();
    const a: SheetViewState = {
      ...view,
      name: 'Revenue',
      frozen: { rows: 2, columns: 1 },
      columnOptions: { 1: { kind: 'currency', currency: 'CZK' } },
    };
    const saved = await adapter.save(a, null, signal);
    await adapter.save({ ...a, viewId: 'other', name: 'Costs' }, null, signal);
    expect((await adapter.list('fixture', signal)).map((v) => v.name)).toEqual([
      'Revenue',
      'Costs',
    ]);
    await expect(adapter.save({ ...a, name: 'Stale' }, null, signal)).rejects.toThrow(
      'another tab',
    );
    expect((await adapter.load(a.viewId, signal))?.state).toEqual(a);
    await adapter.save({ ...a, name: 'Renamed' }, saved.version, signal);
    expect((await adapter.list('fixture', signal)).find((v) => v.viewId === a.viewId)?.name).toBe(
      'Renamed',
    );
    store.dispose();
  });
});
