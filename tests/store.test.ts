import { describe, expect, it } from 'vitest';
import {
  ColumnId,
  createSpreadsheet,
  EngineSession,
  FormulaEngine,
  RowId,
  type DataBlock,
  type DataSource,
  type SourceEvent,
} from '../packages/core/src/index';
import { createLocalSource } from '../packages/transport/src/local';
import { a, c, cell, nth, range, required, rev, sessionCalculator } from './helpers';

function fixture() {
  const session = new EngineSession(
    new FormulaEngine({
      rows: 1000,
      columns: 50,
      cells: [cell(0, 0, 2), cell(0, 1, '=A1*2')],
    }),
  );
  const source = createLocalSource({
    metadata: session.metadata,
    calculator: sessionCalculator(session),
  });
  return { session, source, store: createSpreadsheet({ source }) };
}
const top = range(0, 0, 3, 3);
describe('spreadsheet store', () => {
  it('undoes a multi-cell paste in one transaction and redoes formulas', async () => {
    const { store } = fixture();
    store.setViewport(top);
    await store.ensureRange(top);
    await store.paste('5\t=A1*3\n6\t=A2*3');
    await store.ensureRange(top);
    expect(store.readCell(a(0, 1)).value).toBe(15);
    expect(store.readCell(a(1, 1)).value).toBe(18);
    await store.undo();
    await store.ensureRange(top);
    expect(store.readCell(a(0, 0)).value).toBe(2);
    expect(store.readCell(a(1, 0)).value).toBe(null);
    await store.redo();
    await store.ensureRange(top);
    expect(store.readCell(a(0, 1)).value).toBe(15);
    store.dispose();
  });
  it('rejects out-of-bounds paste atomically', async () => {
    const { store } = fixture();
    store.select(a(999, 49));
    await expect(store.paste('1\t2')).rejects.toThrow('outside');
    expect(store.getSnapshot().canUndo).toBe(false);
    store.dispose();
  });
  it('pastes typed values as one undoable transaction', async () => {
    const { store } = fixture();
    await store.ensureRange(top);
    store.select(a(0, 0));
    store.select(a(0, 1), true);
    const text = store.copy();
    store.select(a(2, 0));
    await store.paste(text, { mode: 'values' });
    await store.ensureRange(top);
    expect(store.readCell(a(2, 1)).input).toBe(4);
    await store.undo();
    await store.ensureRange(top);
    expect(store.readCell(a(2, 0)).value).toBe(null);
    expect(store.readCell(a(2, 1)).value).toBe(null);
    await store.redo();
    await store.ensureRange(top);
    expect(store.readCell(a(2, 1)).value).toBe(4);
    store.dispose();
  });
  it('transposes only formulas and leaves skipped targets and history intact', async () => {
    const { store } = fixture();
    await store.ensureRange(top);
    await store.edit([cell(2, 3, 77), cell(3, 3, 88)]);
    await store.ensureRange(top);
    store.select(a(0, 0));
    store.select(a(0, 1), true);
    const text = store.copy();
    store.select(a(2, 3));
    await store.paste(text, { mode: 'formulas', transpose: true });
    await store.ensureRange(top);
    expect(store.readCell(a(2, 3)).value).toBe(77);
    expect(store.readCell(a(3, 3)).input).toBe('=C4*2');
    await store.undo();
    await store.ensureRange(top);
    expect(store.readCell(a(3, 3)).value).toBe(88);
    await store.redo();
    await store.ensureRange(top);
    expect(store.readCell(a(3, 3)).input).toBe('=C4*2');
    store.dispose();
  });
  it('rejects special paste into a read-only target atomically', async () => {
    const { store, source } = fixture();
    await store.ensureRange(top);
    source.isEditable = ({ col }) => col !== 1;
    await expect(store.paste('9\t8', { mode: 'values' })).rejects.toThrow('read-only');
    expect(store.readCell(a(0, 0)).value).toBe(2);
    expect(store.getSnapshot().canUndo).toBe(false);
    store.dispose();
  });
  it('bounds the block cache and keeps a stable snapshot for unchanged cells', async () => {
    const { source } = fixture();
    const store = createSpreadsheet({ source, maxBlocks: 2 });
    await store.ensureRange(top);
    const first = store.readCell(a(0, 0));
    await store.ensureRange(top);
    expect(store.readCell(a(0, 0))).toBe(first);
    for (const row of [100, 200, 300]) await store.ensureRange(range(row, 0));
    expect(store.cacheStats.blocks).toBe(2);
    expect(store.readCell(a(0, 0)).status).toBe('loading');
    store.dispose();
  });
  it('ignores stale replies after revision changes and aborts on dispose', async () => {
    let emit: ((event: SourceEvent) => void) | undefined;
    const requests: { resolve: (block: DataBlock) => void; signal: AbortSignal }[] = [];
    const source: DataSource = {
      mode: 'remote',
      metadata: { rows: 100, columns: 10, revision: rev(0) },
      rowId: (row) => RowId.unsafe(String(row)),
      columnId: (col) => ColumnId.unsafe(String(col)),
      isEditable: () => false,
      getColumnFormula: () => null,
      mutate: async () => ({ revision: rev(0) }),
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
    required(emit)({ type: 'revision', revision: rev(1) });
    await Promise.resolve();
    const block = (revision: number): DataBlock => ({
      range: top,
      revision: rev(revision),
      cells: [{ ...a(0, 0), input: revision, value: revision, status: 'ready' }],
    });
    expect(nth(requests, 0).signal.aborted).toBe(true);
    nth(requests, 1).resolve(block(1));
    await store.ensureRange(top);
    nth(requests, 0).resolve(block(0));
    await Promise.resolve();
    expect(store.readCell(a(0, 0)).value).toBe(1);
    store.setViewport(range(80, 0));
    await Promise.resolve();
    store.dispose();
    expect(nth(requests, -1).signal.aborted).toBe(true);
  });
  it('keeps history on rejected changes and separates upstream updates', async () => {
    const { store, source } = fixture();
    store.setViewport(top);
    await store.ensureRange(top);
    await store.edit([cell(0, 0, 10)]);
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
    expect(store.readCell(a(0, 0)).value).toBe(2);
    store.dispose();
  });
  it('distinguishes external values from the latest internally copied formula', async () => {
    const { store } = fixture();
    store.setViewport(top);
    await store.ensureRange(top);
    store.select(a(0, 1));
    const text = store.copy();
    store.select(a(1, 1));
    await store.paste(text, false);
    await store.ensureRange(top);
    expect(store.readCell(a(1, 1)).input).toBe(4);
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
      calculator: sessionCalculator(session),
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
    store.select(a(0, 1));
    await store.paste('=A1*3\n=A2*3', false);
    await store.ensureRange(top);
    expect(store.readCell(a(2, 1)).value).toBe(9);
    await expect(store.paste('=A1*3\n=A2*4', false)).rejects.toThrow('consistent');
    expect(source.getColumnFormula(c(1))).toBe('=A1*3');
    await store.clearSelection();
    await store.ensureRange(top);
    expect(store.readCell(a(2, 1)).value).toBe(null);
    await store.undo();
    await store.ensureRange(top);
    expect(store.readCell(a(2, 1)).value).toBe(9);
    store.dispose();
  });
});
