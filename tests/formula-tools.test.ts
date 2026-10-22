import { describe, expect, it } from 'vitest';
import { createLocalSource } from '../packages/transport/src/local';
import {
  FormulaEngine,
  EngineSession,
  parseAddress,
  copyRange,
  pasteCells,
  analyzeFormulaEditing,
  toggleFormulaReference,
  createViewState,
  ViewCalculationRegistry,
  ViewController,
  mapViewFormula,
  type CellInput,
} from '../packages/core/src';
const address = (label: string) => parseAddress(label)!;
function fixture(cells: Record<string, CellInput>, rows = 100000) {
  return new FormulaEngine({
    rows,
    columns: 20,
    cells: Object.entries(cells).map(([label, input]) => ({ ...address(label), input })),
  });
}
const value = (engine: FormulaEngine, label: string) => engine.value(address(label));
describe('additional formula functions', () => {
  it('matches numeric, text, boolean, blank, comparison and escaped wildcard criteria', () => {
    const e = fixture({
      A1: 10,
      A2: 20,
      A3: '10',
      A4: true,
      A5: 'Alpha',
      A6: 'ALPINE',
      A7: 'A*',
      A8: 'A?',
      A9: 'A~',
      B1: '=COUNTIF(A1:A10,">=10")',
      B2: '=COUNTIF(A1:A10,"alp*")',
      B3: '=COUNTIF(A1:A10,"A~*")',
      B4: '=COUNTIF(A1:A10,"A~?")',
      B5: '=COUNTIF(A1:A10,"A~~")',
      B6: '=COUNTIF(A1:A10,TRUE)',
      B7: '=COUNTIF(A1:A10,"")',
      B8: '=COUNTIF(A1:A10,"<>10")',
      B9: '=COUNTIF(A1:A10,"A????")',
    });
    expect(Array.from({ length: 9 }, (_, i) => value(e, `B${i + 1}`))).toEqual([
      2, 2, 1, 1, 1, 1, 1, 9, 1,
    ]);
  });
  it('sums matching values, validates range lengths, and ignores errors only in unmatched sum cells', () => {
    const e = fixture({
      A1: 'yes',
      A2: 'no',
      A3: 'yes',
      B1: 3,
      B2: '=1/0',
      B3: 7,
      C1: '=SUMIF(A1:A3,"YES",B1:B3)',
      C2: '=SUMIF(A1:A3,"no",B1:B3)',
      C3: '=SUMIF(A1:A3,"yes",B1:B2)',
      C4: '=SUMIF(B1:B1,">0")',
      C5: '=COUNTIF(B1:B3,0)',
      C6: '=SUMIF(A1,"missing",B1:B3)',
    });
    expect(value(e, 'C1')).toBe(10);
    expect(value(e, 'C2')).toMatchObject({ error: '#DIV/0!' });
    expect(value(e, 'C3')).toMatchObject({ error: '#VALUE!' });
    expect(value(e, 'C4')).toBe(3);
    expect(value(e, 'C5')).toMatchObject({ error: '#DIV/0!' });
    expect(value(e, 'C6')).toMatchObject({ error: '#VALUE!' });
    e.apply({ cells: [{ ...address('B3'), input: 9 }] });
    expect(value(e, 'C1')).toBe(12);
    e.apply({ cells: [{ ...address('A3'), input: 'no' }] });
    expect(value(e, 'C1')).toBe(3);
  });
  it('streams a complete million-row conditional aggregate with bounded formula state', () => {
    const e = new FormulaEngine({
      rows: 1000000,
      columns: 3,
      readInput: ({ row, col }) => (col === 0 ? row + 1 : col === 1 ? 2 : null),
      cells: [{ row: 0, col: 2, input: '=SUMIF(A1:A1000000,">999990",B1:B1000000)' }],
    });
    expect(value(e, 'C1')).toBe(20);
    expect(e.stats.cachedFormulas).toBe(1);
    expect(e.stats.rangeDependencies).toBe(1);
  });
  it('preserves paired range membership after moving rows and columns in a view', () => {
    const e = fixture({ A1: 'yes', A2: 'no', A3: 'yes', B1: 2, B2: 5, B3: 7 }, 10);
    const v = new ViewController(
      createViewState(
        createLocalSource({
          metadata: { rows: 10, columns: 20, revision: 0 },
          calculator: {
            calculate: async (range) => e.block(range, 0),
            apply: async (mutation, revision) => new EngineSession(e).mutate(mutation, revision),
            dispose() {},
          },
        }),
        { viewId: 'conditional', sourceId: 'test' },
      ),
    );
    v.replace({ ...v.getSnapshot(), cells: { '0:2': '=SUMIF(A1:A3,"yes",B1:B3)' } });
    v.change({ type: 'move', axis: 'rows', start: 1, count: 1, before: 5 });
    v.change({ type: 'move', axis: 'columns', start: 0, count: 1, before: 3 });
    const state = v.getSnapshot();
    const displayed = mapViewFormula(state.cells['0:2'] as string, state, 'display');
    const rebound = mapViewFormula(displayed, state, 'bind');
    const registry = new ViewCalculationRegistry(e);
    const read = (formula: string) =>
      registry.blocks(
        { ...state, cells: { '0:2': formula } },
        [{ start: { row: 0, col: 2 }, end: { row: 0, col: 2 } }],
        0,
      ).blocks[0].cells[0].value;
    expect(read(state.cells['0:2'] as string)).toBe(9);
    expect(read(rebound)).toBe(9);
  });
  it('evaluates IFERROR lazily and propagates argument and logic errors', () => {
    const e = fixture({
      A1: '=IFERROR(7,1/0)',
      A2: '=IFERROR(1/0,9)',
      A3: '=IFERROR(BOGUS(1),"missing")',
      A4: '=AND(TRUE,2,"yes")',
      A5: '=OR(FALSE,0,1)',
      A6: '=NOT(0)',
      A7: '=AND(FALSE,1/0)',
      A8: '=OR(TRUE,1/0)',
      A9: '=ROUND(1)',
      A10: '=NOT(TRUE,FALSE)',
      A11: '=IFERROR(1)',
    });
    expect(['A1', 'A2', 'A3', 'A4', 'A5', 'A6'].map((a) => value(e, a))).toEqual([
      7,
      9,
      'missing',
      true,
      true,
      true,
    ]);
    for (const a of ['A7', 'A8']) expect(value(e, a)).toMatchObject({ error: '#DIV/0!' });
    for (const a of ['A9', 'A10', 'A11']) expect(value(e, a)).toMatchObject({ error: '#VALUE!' });
  });
  it('ignores text and blanks in logical ranges and handles unions', () => {
    const e = fixture({
      A1: true,
      A2: 'text',
      A4: 0,
      B1: '=AND(A1:A3)',
      B2: '=OR(A1:A4)',
      B3: '=AND(A2:A3)',
      B4: '=AND((A1:A1,A4:A4))',
      B5: '=COUNTIF((A1:A1,A4:A4),0)',
    });
    expect(value(e, 'B1')).toBe(true);
    expect(value(e, 'B2')).toBe(true);
    expect(value(e, 'B3')).toMatchObject({ error: '#VALUE!' });
    expect(value(e, 'B4')).toBe(false);
    expect(value(e, 'B5')).toBe(1);
  });
  it('rounds positive and negative ties away from zero without binary scaling errors', () => {
    const e = fixture({
      A1: '=ROUND(1.005,2)',
      A2: '=ROUND(-1.005,2)',
      A3: '=ROUND(125,-1)',
      A4: '=ROUND(-125,-1)',
      A5: '=ROUND(1.2,308)',
      A6: '=ROUND(1,-308)',
      A7: '=ROUND(3,1.5)',
      A8: '=ROUND(3,309)',
    });
    expect(['A1', 'A2', 'A3', 'A4', 'A5', 'A6'].map((a) => value(e, a))).toEqual([
      1.01, -1.01, 130, -130, 1.2, 0,
    ]);
    for (const a of ['A7', 'A8']) expect(value(e, a)).toMatchObject({ error: '#NUM!' });
  });
});
describe('special clipboard', () => {
  const copied = () =>
    copyRange({ start: { row: 0, col: 0 }, end: { row: 1, col: 2 } }, ({ row, col }) => ({
      input: [
        [1, '=A1+$A$1', null],
        ["'001", '="=1+1"', true],
      ][row][col],
      value: [
        [1, 2, null],
        ['001', '=1+1', true],
      ][row][col],
      status: 'ready',
    }));
  it('transposes formulas from each original position and skips constants without filling holes', () => {
    const data = copied();
    expect(
      pasteCells(data.tsv, { row: 3, col: 3 }, data, (a) => a, {
        mode: 'formulas',
        transpose: true,
      }),
    ).toEqual([
      { row: 4, col: 3, input: '=C5+$A$1' },
      { row: 4, col: 4, input: '="=1+1"' },
    ]);
    expect(
      pasteCells('1\t=A1\n3\t4', { row: 2, col: 2 }, null, (a) => a, {
        mode: 'formulas',
        transpose: true,
      }),
    ).toEqual([{ row: 3, col: 2, input: '=A1' }]);
  });
  it('preserves types and literal text when pasting internal values, including empty text and apostrophes', () => {
    const data = copied();
    const patches = pasteCells(data.tsv, { row: 3, col: 3 }, data, (a) => a, { mode: 'values' });
    const e = new FormulaEngine({ rows: 10, columns: 10, cells: patches });
    expect(patches.map((p) => e.value(p))).toEqual([1, 2, null, '001', '=1+1', true]);
    for (const literal of ['', "'quoted", '=1+1', 'TRUE', '001']) {
      const copy = copyRange({ start: address('A1'), end: address('A1') }, () => ({
        input: '="text"',
        value: literal,
        status: 'ready',
      }));
      const [patch] = pasteCells(copy.tsv, address('A1'), copy, (a) => a, { mode: 'values' });
      const engine = new FormulaEngine({ rows: 1, columns: 1, cells: [patch] });
      expect(engine.value(address('A1'))).toBe(literal);
      const recopy = copyRange({ start: address('A1'), end: address('A1') }, () => ({
        input: patch.input,
        value: engine.value(address('A1')),
        status: 'ready',
      }));
      expect(pasteCells(recopy.tsv, address('A1'), recopy)[0].input).toBe(patch.input);
    }
  });
  it('never evaluates external value text and respects the internal token opt-out', () => {
    const data = copied();
    const [patch] = pasteCells('=1+1', address('A1'), null, (a) => a, { mode: 'values' });
    expect(fixture({ A1: patch.input }).value(address('A1'))).toBe('=1+1');
    expect(
      pasteCells(data.tsv, address('A1'), data, (a) => a, { useInternalFormulas: false })[1].input,
    ).toBe(2);
    expect(() =>
      pasteCells('x\t'.repeat(10000), address('A1'), null, (a) => a, { mode: 'formulas' }),
    ).toThrow('10,000');
  });
});
describe('formula editing analysis', () => {
  it('cycles anchors, preserves selection and ignores quoted references', () => {
    let draft = '=A1';
    let caret = 3;
    for (const expected of ['=$A$1', '=A$1', '=$A1', '=A1']) {
      const next = toggleFormulaReference(draft, caret)!;
      expect(next.value).toBe(expected);
      expect(next.start).toBe(expected.length);
      draft = next.value;
      caret = next.start;
    }
    expect(toggleFormulaReference('=SUM(A1:B2)', 5, 10)).toEqual({
      value: '=SUM($A$1:$B$2)',
      start: 5,
      end: 14,
    });
    expect(toggleFormulaReference('="A1"&B1', 3)).toBe(null);
    expect(toggleFormulaReference('=A1_name', 3)).toBe(null);
  });
  it('highlights nested pairs and distinguishes unfinished formulas from actual errors', () => {
    expect(analyzeFormulaEditing('=SUM((A1),2)', 6).bracketPair).toEqual([5, 8]);
    expect(analyzeFormulaEditing('="("&A1', 3).bracketPair).toBe(null);
    for (const draft of ['=SUM(', '=SUM(A1', '=1+', '="text', '=', '=SU'])
      expect(analyzeFormulaEditing(draft, draft.length).diagnostics[0].severity).toBe('incomplete');
    for (const draft of ['=SUM(1))', '=1@2', '=BOGUS(1)', '=ROUND(1)'])
      expect(analyzeFormulaEditing(draft, draft.length).diagnostics[0].severity).toBe('error');
    expect(analyzeFormulaEditing('=SUMIF(A1:A3,">0")', 22).diagnostics).toEqual([]);
  });
});
