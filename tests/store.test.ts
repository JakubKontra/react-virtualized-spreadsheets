import { describe, expect, it } from 'vitest';
import {
  createSpreadsheet,
  EngineSession,
  FormulaEngine,
  type DataBlock,
  type DataSource,
  type SourceEvent,
} from '../packages/core/src/index';
import { createLocalSource } from '../packages/transport/src/local';

function fixture() {
  const session = new EngineSession(
    new FormulaEngine({
      rows: 1000,
      columns: 50,
      cells: [
        { row: 0, col: 0, input: 2 },
        { row: 0, col: 1, input: '=A1*2' },
      ],
    }),
  );
  const source = createLocalSource({
    metadata: session.metadata,
    calculator: {
      async calculate(range) {
        return session.block(range);
      },
      async apply(mutation, revision) {
        return session.mutate(mutation, revision);
      },
      dispose() {},
    },
  });
  return { session, source, store: createSpreadsheet({ source }) };
}
const top = { start: { row: 0, col: 0 }, end: { row: 3, col: 3 } };
describe('spreadsheet store', () => {
  it('undoes a multi-cell paste in one transaction and redoes formulas', async () => {
    const { store } = fixture();
    store.setViewport(top);
    await store.ensureRange(top);
    await store.paste('5\t=A1*3\n6\t=A2*3');
    await store.ensureRange(top);
    expect(store.readCell({ row: 0, col: 1 }).value).toBe(15);
    expect(store.readCell({ row: 1, col: 1 }).value).toBe(18);
    await store.undo();
    await store.ensureRange(top);
    expect(store.readCell({ row: 0, col: 0 }).value).toBe(2);
    expect(store.readCell({ row: 1, col: 0 }).value).toBe(null);
    await store.redo();
    await store.ensureRange(top);
    expect(store.readCell({ row: 0, col: 1 }).value).toBe(15);
    store.dispose();
  });
  it('rejects out-of-bounds paste atomically', async () => {
    const { store } = fixture();
    store.select({ row: 999, col: 49 });
    await expect(store.paste('1\t2')).rejects.toThrow('outside');
    expect(store.getSnapshot().canUndo).toBe(false);
    store.dispose();
  });
  it('pastes typed values as one undoable transaction', async () => {
    const { store } = fixture();
    await store.ensureRange(top);
    store.select({ row: 0, col: 0 });
    store.select({ row: 0, col: 1 }, true);
    const text = store.copy();
    store.select({ row: 2, col: 0 });
    await store.paste(text, { mode: 'values' });
    await store.ensureRange(top);
    expect(store.readCell({ row: 2, col: 1 }).input).toBe(4);
    await store.undo();
    await store.ensureRange(top);
    expect(store.readCell({ row: 2, col: 0 }).value).toBe(null);
    expect(store.readCell({ row: 2, col: 1 }).value).toBe(null);
    await store.redo();
    await store.ensureRange(top);
    expect(store.readCell({ row: 2, col: 1 }).value).toBe(4);
    store.dispose();
  });
  it('transposes only formulas and leaves skipped targets and history intact', async () => {
    const { store } = fixture();
    await store.ensureRange(top);
    await store.edit([
      { row: 2, col: 3, input: 77 },
      { row: 3, col: 3, input: 88 },
    ]);
    await store.ensureRange(top);
    store.select({ row: 0, col: 0 });
    store.select({ row: 0, col: 1 }, true);
    const text = store.copy();
    store.select({ row: 2, col: 3 });
    await store.paste(text, { mode: 'formulas', transpose: true });
    await store.ensureRange(top);
    expect(store.readCell({ row: 2, col: 3 }).value).toBe(77);
    expect(store.readCell({ row: 3, col: 3 }).input).toBe('=C4*2');
    await store.undo();
    await store.ensureRange(top);
    expect(store.readCell({ row: 3, col: 3 }).value).toBe(88);
    await store.redo();
    await store.ensureRange(top);
    expect(store.readCell({ row: 3, col: 3 }).input).toBe('=C4*2');
    store.dispose();
  });
  it('rejects special paste into a read-only target atomically', async () => {
    const { store, source } = fixture();
    await store.ensureRange(top);
    source.isEditable = ({ col }) => col !== 1;
    await expect(store.paste('9\t8', { mode: 'values' })).rejects.toThrow('read-only');
    expect(store.readCell({ row: 0, col: 0 }).value).toBe(2);
    expect(store.getSnapshot().canUndo).toBe(false);
    store.dispose();
  });
  it('bounds the block cache and keeps a stable snapshot for unchanged cells', async () => {
    const { source } = fixture();
    const store = createSpreadsheet({ source, maxBlocks: 2 });
    await store.ensureRange(top);
    const first = store.readCell({ row: 0, col: 0 });
    await store.ensureRange(top);
    expect(store.readCell({ row: 0, col: 0 })).toBe(first);
    for (const row of [100, 200, 300])
      await store.ensureRange({ start: { row, col: 0 }, end: { row, col: 0 } });
    expect(store.cacheStats.blocks).toBe(2);
    expect(store.readCell({ row: 0, col: 0 }).status).toBe('loading');
    store.dispose();
  });
  it('ignores stale replies after revision changes and aborts on dispose', async () => {
    let emit!: (event: SourceEvent) => void;
    const requests: { resolve: (block: DataBlock) => void; signal: AbortSignal }[] = [];
    const source: DataSource = {
      mode: 'remote',
      metadata: { rows: 100, columns: 10, revision: 0 },
      rowId: String,
      columnId: String,
      isEditable: () => false,
      getColumnFormula: () => null,
      mutate: async () => ({ revision: 0 }),
      subscribe(listener) {
        emit = listener;
        return () => {};
      },
      dispose() {},
      getBlock(_range, signal) {
        return new Promise((resolve) => requests.push({ resolve, signal }));
      },
    };
    const store = createSpreadsheet({ source });
    store.setViewport(top);
    await Promise.resolve();
    emit({ revision: 1 });
    await Promise.resolve();
    const block = (revision: number): DataBlock => ({
      range: top,
      revision,
      cells: [{ row: 0, col: 0, input: revision, value: revision, status: 'ready' }],
    });
    expect(requests[0].signal.aborted).toBe(true);
    requests[1].resolve(block(1));
    await store.ensureRange(top);
    requests[0].resolve(block(0));
    await Promise.resolve();
    expect(store.readCell({ row: 0, col: 0 }).value).toBe(1);
    store.setViewport({ start: { row: 80, col: 0 }, end: { row: 80, col: 0 } });
    await Promise.resolve();
    store.dispose();
    expect(requests.at(-1)!.signal.aborted).toBe(true);
  });
  it('keeps history on rejected changes and separates upstream updates', async () => {
    const { store, source } = fixture();
    store.setViewport(top);
    await store.ensureRange(top);
    await store.edit([{ row: 0, col: 0, input: 10 }]);
    await store.ensureRange(top);
    const original = source.mutate;
    source.mutate = async () => {
      throw new Error('Rejected');
    };
    await expect(store.undo()).rejects.toThrow('Rejected');
    expect(store.getSnapshot().canUndo).toBe(true);
    source.mutate = original;
    await store.undo();
    await store.ensureRange(top);
    expect(store.readCell({ row: 0, col: 0 }).value).toBe(2);
    store.dispose();
  });
  it('distinguishes external values from the latest internally copied formula', async () => {
    const { store } = fixture();
    store.setViewport(top);
    await store.ensureRange(top);
    store.select({ row: 0, col: 1 });
    const text = store.copy();
    store.select({ row: 1, col: 1 });
    await store.paste(text, false);
    await store.ensureRange(top);
    expect(store.readCell({ row: 1, col: 1 }).input).toBe(4);
    store.dispose();
  });
  it('pastes and clears consistent server templates atomically, with undo', async () => {
    const session = new EngineSession(
      new FormulaEngine({
        rows: 10,
        columns: 5,
        readInput: ({ row, col }) => (col === 0 ? row + 1 : null),
      }),
      ({ col }) => col > 0,
      true,
    );
    const base = createLocalSource({
      metadata: session.metadata,
      editable: ({ col }) => col > 0,
      calculator: {
        async calculate(range) {
          return session.block(range);
        },
        async apply(mutation, revision) {
          return session.mutate(mutation, revision);
        },
        dispose() {},
      },
    });
    const source: DataSource = {
      ...base,
      mode: 'remote',
      get metadata() {
        return base.metadata;
      },
    };
    const store = createSpreadsheet({ source });
    store.setViewport(top);
    await store.ensureRange(top);
    store.select({ row: 0, col: 1 });
    await store.paste('=A1*3\n=A2*3', false);
    await store.ensureRange(top);
    expect(store.readCell({ row: 2, col: 1 }).value).toBe(9);
    await expect(store.paste('=A1*3\n=A2*4', false)).rejects.toThrow('consistent');
    expect(source.getColumnFormula(1)).toBe('=A1*3');
    await store.clearSelection();
    await store.ensureRange(top);
    expect(store.readCell({ row: 2, col: 1 }).value).toBe(null);
    await store.undo();
    await store.ensureRange(top);
    expect(store.readCell({ row: 2, col: 1 }).value).toBe(9);
    store.dispose();
  });
});
