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
  SourceId,
  ViewCalculationRegistry,
  ViewId,
  type SheetViewState,
} from '../packages/core/src';
import { createLocalSource } from '../packages/transport/src/local';
import { LocalStorageViewAdapter } from '../packages/transport/src/persistence';
import {
  a,
  cc,
  cell,
  cells,
  r,
  range as cellRange,
  requireViews,
  required,
  rev,
  sessionCalculator,
  signal as newSignal,
  viewOf,
} from './helpers';
function fixture(rows = 2000) {
  const engine = new FormulaEngine({
    rows,
    columns: 5,
    readInput: ({ row, col }) =>
      col === 0 ? row + 1 : col === 1 ? row % 3 : col === 2 ? `group-${row % 2}` : null,
  });
  const session = new EngineSession(engine),
    registry = new ViewCalculationRegistry(engine);
  const source = requireViews(
    createLocalSource({
      metadata: session.metadata,
      calculator: sessionCalculator(session, registry),
    }),
  );
  const view = createViewState(source, { viewId: 'features', sourceId: 'fixture' }),
    store = createSpreadsheet({ source, view: { state: view } });
  return { store, registry, view, engine, session, source };
}
async function ready(store: ReturnType<typeof fixture>['store']) {
  await expect.poll(() => store.getSnapshot().querying).toBe(false);
}
/** Rows `r0..r1` of columns `c0..c1`. */
const range = (r0: number, r1: number, c0 = 0, c1 = c0) => cellRange(r0, c0, r1, c1);
describe('full dataset queries and summaries', () => {
  it('filters unloaded rows, sorts by multiple columns and preserves logical formula references', async () => {
    const { store } = fixture();
    store.configure({
      query: {
        filters: [{ col: cc(0), operator: 'gte', value: 1990 }],
        sorts: [
          { col: cc(1), direction: 'asc' },
          { col: cc(0), direction: 'desc' },
        ],
      },
    });
    await ready(store);
    expect(store.rows).toBe(11);
    await store.ensureRange(range(0, 10, 0, 2));
    expect(store.readCell(a(0, 0)).value).toBe(1999);
    expect(store.labelAddress(a(0, 0))).toBe('A1999');
    expect(store.resolveAddress('A1999')).toEqual(a(0, 0));
    expect(() =>
      store.changeView({ type: 'move', axis: 'rows', start: r(0), count: 1, before: r(2) }),
    ).toThrow('Clear sorting');
    await store.edit([cell(0, 0, 9999)]);
    await ready(store);
    expect(viewOf(store).getSnapshot().cells['1998:0']).toBe(9999);
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
    expect(store.source.isEditable(a(0, 0))).toBe(false);
    await store.undo();
    await ready(store);
    expect(store.rows).toBe(2000);
    store.configure({ query: { search: 'missing' } });
    store.configure({ query: { filters: [{ col: cc(0), operator: 'equals', value: 2000 }] } });
    await ready(store);
    expect(store.rows).toBe(1);
    expect(store.labelAddress(a(0, 0))).toBe('A2000');
    store.dispose();
  });
  it('keeps an edited record attached to its identity when live sorting moves it', async () => {
    const { store, source } = fixture();
    store.configure({ query: { sorts: [{ col: cc(0), direction: 'desc' }] } });
    await ready(store);
    await store.ensureRange(range(0, 0, 0, 4));
    store.select(a(0, 3));
    store.beginEdit(undefined, '=A2000');
    await source.mutate(cells(cell(1999, 0, 0)), rev(0), new AbortController().signal);
    await ready(store);
    expect(store.getSnapshot().editing).toEqual(a(1999, 3));
    expect(store.getSnapshot().draft).toBe('=A2000');
    expect(store.labelAddress(required(store.getSnapshot().editing))).toBe('D2000');
    const unsubscribe = store.subscribe(() => {
      if (store.getSnapshot().querying && store.getSnapshot().editing) store.cancelEdit();
    });
    await source.mutate(cells(cell(1999, 0, 2000)), rev(1), new AbortController().signal);
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
        filters: [{ col: cc(0), operator: 'gte', value: 1999 }],
        sorts: [{ col: cc(0), direction: 'desc' }],
      },
    });
    await ready(store);
    await store.ensureRange(range(0, 1, 0, 4));
    store.select(a(0, 3));
    store.beginEdit(undefined, '=A2000');
    await source.mutate(cells(cell(1999, 0, 0)), rev(0), new AbortController().signal);
    await ready(store);
    expect(store.rows).toBe(1);
    expect(store.getSnapshot().editing).toBeNull();
    expect(store.getSnapshot().error).toContain('Unsaved draft: =A2000');
    expect(viewOf(store).getSnapshot().cells).toEqual({});
    store.dispose();
  });
  it('summarizes the complete filtered selection and invalidates after an upstream revision', async () => {
    const { registry, view, session } = fixture();
    const filtered: SheetViewState = {
      ...view,
      query: { filters: [{ col: cc(0), operator: 'gt', value: 1990 }] },
    };
    const summary = registry.summary(filtered, range(0, 9), rev(0));
    expect(summary).toMatchObject({
      count: 10,
      numericCount: 10,
      sum: 19955,
      average: 1995.5,
      min: 1991,
      max: 2000,
    });
    session.mutate(cells(cell(1999, 0, 10000)), rev(0));
    expect(registry.summary(filtered, range(0, 9), rev(1)).sum).toBe(27955);
  });
});
describe('autofill and formats', () => {
  it('extends linear sequences in both directions, dates, and mixed formula anchors', () => {
    const values = [10, 15];
    expect(
      createFillPatches(range(2, 3), range(0, 5), (address) => values[address.row - 2] ?? null).map(
        (p) => p.input,
      ),
    ).toEqual([0, 5, 20, 25]);
    expect(
      createFillPatches(range(0, 0), range(0, 2), () => '2024-02-28').map((p) => p.input),
    ).toEqual(['2024-02-29', '2024-03-01']);
    expect(createFillPatches(range(0, 0), range(0, 1), () => '=$A1+B$2+$C$3')[0]?.input).toBe(
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
    expect(viewOf(store).getSnapshot().cells['8:0']).toBe(9);
    await store.undo();
    expect(viewOf(store).getSnapshot().cells).toEqual({});
    store.configure({ columnOptions: { 0: { kind: 'number' } } });
    await store.ensureRange(range(0, 1));
    await expect(store.edit([cell(0, 0, 4), cell(1, 0, 'bad')])).rejects.toThrow('valid number');
    expect(viewOf(store).getSnapshot().cells).toEqual({});
    store.dispose();
  });
  it('parses percentages and text, formats currency and matches conditions on raw values', () => {
    expect(parseTypedInput('25%', { kind: 'percent' })).toBe(0.25);
    expect(parseTypedInput('0012', { kind: 'text' })).toBe('0012');
    expect(formatCellValue(0.25, { kind: 'percent', decimals: 1 })).toBe('25.0%');
    expect(formatCellValue(12, { kind: 'currency', currency: 'EUR', decimals: 2 }, 'en-US')).toBe(
      '€12.00',
    );
    expect(matchesFilter(-0.1, { col: cc(0), operator: 'lt', value: 0 })).toBe(true);
    expect(matchesFilter(null, { col: cc(0), operator: 'lt', value: 0 })).toBe(false);
    expect(matchesFilter('', { col: cc(0), operator: 'empty' })).toBe(true);
  });
  it('saves names, formats and frozen panes independently in the catalog', async () => {
    const data = new Map<string, string>(),
      adapter = new LocalStorageViewAdapter({
        getItem: (k) => data.get(k) ?? null,
        setItem: (k, v) => {
          data.set(k, v);
        },
      }),
      signal = newSignal();
    const { view, store } = fixture();
    const revenue: SheetViewState = {
      ...view,
      name: 'Revenue',
      frozen: { rows: 2, columns: 1 },
      columnOptions: { 1: { kind: 'currency', currency: 'CZK' } },
    };
    const saved = await adapter.save(revenue, null, signal);
    await adapter.save({ ...revenue, viewId: ViewId.unsafe('other'), name: 'Costs' }, null, signal);
    expect((await adapter.list(SourceId.unsafe('fixture'), signal)).map((v) => v.name)).toEqual([
      'Revenue',
      'Costs',
    ]);
    await expect(adapter.save({ ...revenue, name: 'Stale' }, null, signal)).rejects.toThrow(
      'another tab',
    );
    expect((await adapter.load(revenue.viewId, signal))?.state).toEqual(revenue);
    await adapter.save({ ...revenue, name: 'Renamed' }, saved.version, signal);
    expect(
      (await adapter.list(SourceId.unsafe('fixture'), signal)).find(
        (v) => v.viewId === revenue.viewId,
      )?.name,
    ).toBe('Renamed');
    store.dispose();
  });
});
