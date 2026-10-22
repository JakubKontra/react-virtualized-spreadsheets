import { describe, expect, it } from 'vitest';
import {
  changeView,
  createSpreadsheet,
  createViewState,
  EngineSession,
  FormulaEngine,
  ViewAxis,
  ViewCalculationRegistry,
  type DataSource,
  type SheetViewState,
} from '../packages/core/src';
import { createLocalSource } from '../packages/transport/src/local';

function fixture(mode: 'local' | 'remote' = 'local', rows = 20) {
  const engine = new FormulaEngine({
    rows,
    columns: 5,
    readInput: ({ row, col }) => (col === 0 ? row + 1 : col === 1 ? (row + 1) * 10 : null),
  });
  const session = new EngineSession(engine);
  const registry = new ViewCalculationRegistry(engine);
  const base = createLocalSource({
    metadata: session.metadata,
    calculator: {
      async calculate(range) {
        return session.block(range);
      },
      async calculateView(view, ranges) {
        return registry.blocks(view, ranges, session.metadata.revision);
      },
      async apply(mutation, revision) {
        return session.mutate(mutation, revision);
      },
      dispose() {},
    },
  });
  const source: DataSource = {
    ...base,
    mode,
    get metadata() {
      return base.metadata;
    },
  };
  const view = createViewState(source, {
    viewId: 'test',
    sourceId: 'source',
    ownedColumns: [2, 3, 4],
  });
  const store = createSpreadsheet({ source, viewState: view });
  return { engine, session, registry, source, view, store };
}
const area = { start: { row: 0, col: 0 }, end: { row: 5, col: 4 } };
const one = (row: number, col: number) => ({ start: { row, col }, end: { row, col } });

describe('compact view structure', () => {
  it('moves and hides a million rows without expanding source identities', () => {
    const { store, engine } = fixture('remote', 1000000);
    store.select({ row: 4, col: 0 });
    store.changeView({ type: 'move', axis: 'rows', start: 4, count: 500000, before: 1000000 });
    expect(store.getSnapshot().active.row).toBe(500000);
    expect(store.view!.rows.canonicalAt(500000)).toBe(4);
    store.changeView({ type: 'hide', axis: 'rows', start: 0, count: 400000 });
    expect(store.rows).toBe(600000);
    expect(JSON.stringify(store.view!.getSnapshot()).length).toBeLessThan(1500);
    expect(engine.input({ row: 4, col: 0 })).toBe(5);
    store.dispose();
  });
  it('preserves IDs, hidden items and sparse sizes through moves and undo', async () => {
    const { store } = fixture();
    const original = store.source.rowId(2);
    store.changeView({ type: 'resize', axis: 'rows', start: 2, count: 2, size: 60 });
    store.changeView({ type: 'hide', axis: 'rows', start: 1, count: 1 });
    store.changeView({ type: 'move', axis: 'rows', start: 1, count: 1, before: 0 });
    expect(store.source.rowId(0)).toBe(original);
    expect(store.view!.rows.size(0, 32)).toBe(60);
    await store.undo();
    await store.undo();
    expect(store.source.rowId(2)).toBe(original);
    expect(store.view!.rows.size(2, 32)).toBe(60);
    await store.undo();
    expect(store.view!.rows.size(2, 32)).toBe(32);
    await store.redo();
    expect(store.view!.rows.size(2, 32)).toBe(60);
    store.dispose();
  });
  it('rejects source removal, invalid positions and hiding the entire sheet atomically', () => {
    const { store } = fixture();
    const original = store.view!.getSnapshot();
    for (const action of [
      { type: 'remove' as const, axis: 'rows' as const, start: 0, count: 1 },
      { type: 'hide' as const, axis: 'rows' as const, start: 0, count: 20 },
      { type: 'insert' as const, axis: 'rows' as const, before: 0.5 },
      { type: 'resize' as const, axis: 'columns' as const, start: 0, count: 1, size: NaN },
    ])
      expect(() => store.changeView(action)).toThrow();
    expect(store.view!.getSnapshot()).toBe(original);
    store.dispose();
  });
  it('matches an array model through mixed interval operations', () => {
    let { view } = fixture();
    let expected = Array.from({ length: 20 }, (_, i) => i);
    let random = 471;
    const next = (n: number) => {
      random = (random * 16807) % 2147483647;
      return random % n;
    };
    for (let i = 0; i < 250; i++) {
      const start = next(expected.length);
      const count = Math.min(next(4) + 1, expected.length - start);
      const before = next(expected.length + 1);
      view = changeView(view, { type: 'move', axis: 'rows', start, count, before });
      if (before < start || before > start + count) {
        const items = expected.splice(start, count);
        expected.splice(before > start ? before - count : before, 0, ...items);
      }
      const axis = new ViewAxis(view.rows);
      expect(Array.from({ length: axis.count }, (_, j) => axis.canonicalAt(j))).toEqual(expected);
    }
  });
});

describe('view formulas and edits', () => {
  it('keeps references and range membership through reorder, hide and insertion', async () => {
    const { store, engine } = fixture();
    await store.ensureRange(area);
    await store.edit([
      { row: 0, col: 2, input: '=SUM(A1:A3)' },
      { row: 0, col: 3, input: '=A2' },
    ]);
    store.changeView({ type: 'move', axis: 'rows', start: 1, count: 1, before: 5 });
    await store.ensureRange(area);
    expect(store.readCell({ row: 0, col: 2 }).value).toBe(6);
    expect(store.readCell({ row: 0, col: 2 }).input).toBe('=SUM((A1:A2,A5:A5))');
    expect(store.readCell({ row: 0, col: 3 }).input).toBe('=A5');
    store.changeView({ type: 'hide', axis: 'rows', start: 4, count: 1 });
    store.changeView({ type: 'insert', axis: 'rows', before: 1 });
    await store.ensureRange(area);
    await store.edit([{ row: 1, col: 0, input: 1000 }]);
    await store.ensureRange(area);
    expect(store.readCell({ row: 0, col: 2 }).value).toBe(6);
    expect(store.readCell({ row: 0, col: 3 }).value).toBe(2);
    expect(engine.input({ row: 0, col: 2 })).toBe(null);
    expect(store.resolveAddress('A6')).toBe(null); // Hidden source row retains its logical label.
    store.dispose();
  });
  it('binds a new discontiguous range and restores removed references with undo', async () => {
    const { store } = fixture();
    store.changeView({ type: 'insert', axis: 'rows', before: 1 });
    await store.ensureRange(area);
    await store.edit([{ row: 1, col: 0, input: 100 }]);
    await store.ensureRange(area);
    await store.edit([
      { row: 0, col: 2, input: '=SUM(A1:A3)' },
      { row: 0, col: 3, input: '=A2' },
    ]);
    await store.ensureRange(area);
    expect(store.readCell({ row: 0, col: 2 }).value).toBe(103);
    store.changeView({ type: 'remove', axis: 'rows', start: 1, count: 1 });
    await store.ensureRange(area);
    expect(store.readCell({ row: 0, col: 2 }).value).toBe(3);
    expect(store.readCell({ row: 0, col: 3 }).value).toMatchObject({ error: '#REF!' });
    await store.undo();
    await store.ensureRange(area);
    expect(store.readCell({ row: 0, col: 2 }).value).toBe(103);
    expect(store.readCell({ row: 0, col: 3 }).value).toBe(100);
    store.dispose();
  });
  it('moves columns while preserving formulas, absolute refs and source identities', async () => {
    const { store } = fixture();
    await store.ensureRange(area);
    await store.edit([{ row: 0, col: 2, input: '=$A$1+B1' }]);
    store.changeView({ type: 'move', axis: 'columns', start: 0, count: 1, before: 3 });
    await store.ensureRange(area);
    expect(store.readCell({ row: 0, col: 1 }).value).toBe(11);
    expect(store.readCell({ row: 0, col: 1 }).input).toBe('=($C$1+A1)');
    expect(store.readCell({ row: 0, col: 2 }).value).toBe(1);
    store.dispose();
  });
  it('copies formulas using logical offsets across hidden rows', async () => {
    const { store } = fixture();
    await store.ensureRange(area);
    await store.edit([{ row: 0, col: 2, input: '=A1+$B$1' }]);
    store.changeView({ type: 'hide', axis: 'rows', start: 1, count: 1 });
    await store.ensureRange(area);
    store.select({ row: 0, col: 2 });
    const copied = store.copy();
    store.select({ row: 1, col: 2 });
    await store.paste(copied);
    await store.ensureRange(area);
    expect(store.readCell({ row: 1, col: 2 }).input).toBe('=A3+$B$1');
    expect(store.readCell({ row: 1, col: 2 }).value).toBe(13);
    store.dispose();
  });
  it('roundtrips postfix percent and reversed mixed-anchor ranges in a reordered view', async () => {
    const { store } = fixture();
    store.changeView({ type: 'move', axis: 'rows', start: 10, count: 1, before: 15 });
    await store.ensureRange(area);
    await store.edit([{ row: 0, col: 2, input: '=A1*10%+SUM(B$1:$A3)' }]);
    await store.ensureRange(area);
    expect(store.readCell({ row: 0, col: 2 }).value).toBeCloseTo(66.1);
    store.select({ row: 0, col: 2 });
    const copied = store.copy();
    store.select({ row: 1, col: 2 });
    await store.paste(copied);
    await store.ensureRange(area);
    expect(store.readCell({ row: 1, col: 2 }).value).toBeCloseTo(110.2);
    store.dispose();
  });
  it('keeps copied references attached when the view moves before paste', async () => {
    const { store } = fixture();
    await store.ensureRange(area);
    await store.edit([{ row: 0, col: 2, input: '=A1+$B$1' }]);
    await store.ensureRange(area);
    store.select({ row: 0, col: 2 });
    const copied = store.copy();
    store.changeView({ type: 'move', axis: 'columns', start: 0, count: 1, before: 3 });
    await store.ensureRange(area);
    store.select({ row: 1, col: 1 });
    await store.paste(copied);
    await store.ensureRange(area);
    expect(store.readCell({ row: 1, col: 1 }).value).toBe(12);
    expect(store.readCell({ row: 1, col: 1 }).input).toBe('=(C2+$A$1)');
    store.dispose();
  });
  it('isolates server templates and custom values from source writes', async () => {
    const { store, engine, registry, view, session } = fixture('remote');
    await store.ensureRange(area);
    await store.edit([{ row: 0, col: 2, input: '=A1*2' }]);
    await store.ensureRange(area);
    expect(store.readCell({ row: 2, col: 2 }).value).toBe(6);
    expect(engine.input({ row: 0, col: 2 })).toBe(null);
    const second: SheetViewState = { ...view, viewId: 'other', columnFormulas: { 2: '=A1*3' } };
    expect(registry.blocks(second, [one(2, 2)], 0).blocks[0].cells[0].value).toBe(9);
    const first = store.view!.getSnapshot();
    expect(registry.blocks(first, [one(2, 2)], 0).blocks[0].cells[0].value).toBe(6);
    session.mutate({ cells: [{ row: 2, col: 0, input: 10 }] }, 0);
    expect(registry.blocks(first, [one(2, 2)], 1).blocks[0].cells[0].value).toBe(20);
    expect(registry.blocks(second, [one(2, 2)], 1).blocks[0].cells[0].value).toBe(30);
    await expect(store.edit([{ row: 0, col: 0, input: 100 }])).rejects.toThrow('read-only');
    store.changeView({ type: 'insert', axis: 'rows', before: 0 });
    await store.ensureRange(area);
    await expect(store.setColumnFormula(0, '=99')).rejects.toThrow('read-only');
    await store.edit([{ row: 0, col: 0, input: 77 }]);
    await store.ensureRange(area);
    expect(store.readCell({ row: 0, col: 0 }).value).toBe(77);
    store.dispose();
  });
});
