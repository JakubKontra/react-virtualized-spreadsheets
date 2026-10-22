import { describe, expect, it } from 'vitest';
import {
  FormulaEngine,
  EngineSession,
  shiftFormula,
  decodeTSV,
  encodeTSV,
  pasteCells,
  copyRange,
  type CellInput,
  type EngineOptions,
} from '../packages/core/src/index';
import { A1, a, cell, cells, range, rev } from './helpers';

function engine(inputs: Record<string, CellInput>, options: Partial<EngineOptions> = {}) {
  return new FormulaEngine({
    rows: 100000,
    columns: 50,
    cells: Object.entries(inputs).map(([label, input]) => ({ ...A1(label), input })),
    ...options,
  });
}
const at = (sheet: FormulaEngine, label: string) => sheet.value(A1(label));
describe('formula engine', () => {
  it('evaluates precedence, exponentiation, percentages, text and lazy IF', () => {
    const sheet = engine({
      A1: '=2+3*4',
      A2: '=(2+3)*4',
      A3: '=2^3^2',
      A4: '=IF(2>1,"yes","no")',
      A5: '=IF(FALSE,1/0,50%)',
      A6: '="a"&"b"',
      A7: '=-2^2',
    });
    expect(['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7'].map((label) => at(sheet, label))).toEqual([
      14,
      20,
      512,
      'yes',
      0.5,
      'ab',
      -4,
    ]);
  });
  it('handles aggregates, blanks, boolean values and numeric strings explicitly', () => {
    const sheet = engine({
      A1: 10,
      A2: 20,
      A3: '30',
      A4: true,
      B1: '=SUM(A1:A5)',
      B2: '=AVERAGE(A1:A5)',
      B3: '=COUNT(A1:A5)',
      B4: '=MIN(A1:A5)',
      B5: '=MAX(A1:A5)',
      B6: '=A3+1',
      B7: '=A5+1',
      B8: '=AVERAGE(C1:C4)',
    });
    expect(['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7'].map((label) => at(sheet, label))).toEqual([
      30, 15, 2, 10, 20, 31, 1,
    ]);
    expect(at(sheet, 'B8')).toMatchObject({ error: '#DIV/0!' });
  });
  it('reports syntax, division, reference, name, numeric and cycle errors', () => {
    const sheet = engine({
      A1: '=B1',
      B1: '=A1',
      C1: '=A1+1',
      A2: '=1/0',
      A3: '=BOGUS(1)',
      A4: '=AZ1',
      A5: '=1+',
      A6: '=10^999',
      A7: '=globalThis.alert(1)',
      A8: '=SUM(A2:A3)',
    });
    expect(['A1', 'B1', 'C1'].map((label) => at(sheet, label))).toEqual(
      Array(3).fill({ error: '#CYCLE!', message: 'Circular reference' }),
    );
    for (const [label, error] of [
      ['A2', '#DIV/0!'],
      ['A3', '#NAME?'],
      ['A4', '#REF!'],
      ['A5', '#ERROR!'],
      ['A6', '#NUM!'],
      ['A7', '#ERROR!'],
      ['A8', '#DIV/0!'],
    ] as const)
      expect(at(sheet, label)).toMatchObject({ error });
    sheet.apply(cells(cell(0, 1, 4)));
    expect(at(sheet, 'C1')).toBe(5);
  });
  it('invalidates only cached dependents and stores a range as one dependency', () => {
    const sheet = engine({
      A1: 2,
      A2: 3,
      B1: '=A1*2',
      B2: '=A2*2',
      C1: '=SUM(A1:A100000)',
      D1: '=B1+C1',
    });
    expect(at(sheet, 'D1')).toBe(9);
    expect(at(sheet, 'B2')).toBe(6);
    const before = sheet.evaluations;
    sheet.apply(cells(cell(0, 0, 4)));
    expect(at(sheet, 'B2')).toBe(6);
    expect(sheet.evaluations).toBe(before);
    expect(at(sheet, 'D1')).toBe(15);
    expect(sheet.evaluations - before).toBe(3);
    expect(sheet.stats.rangeDependencies).toBe(1);
  });
  it('keeps cached chains correct across eviction and bounds memory', () => {
    const sheet = engine(
      { A1: 1, B1: '=A1+1', C1: '=B1+1', D1: '=C1+1', E1: '=4+5' },
      { maxCachedFormulas: 2 },
    );
    expect(at(sheet, 'D1')).toBe(4);
    at(sheet, 'E1');
    sheet.apply(cells(cell(0, 0, 10)));
    expect(at(sheet, 'D1')).toBe(13);
    expect(sheet.stats.cachedFormulas).toBeLessThanOrEqual(2);
  });
  it('evaluates lazy columns and aggregates over a million source rows', () => {
    const sheet = new FormulaEngine({
      rows: 1000000,
      columns: 3,
      readInput: ({ row, col }) => (col === 0 ? row + 1 : null),
      columnFormulas: { 1: '=A1*2' },
      cells: [cell(0, 2, '=SUM(A1:A1000000)')],
    });
    expect(at(sheet, 'C1')).toBe(500000500000);
    expect(at(sheet, 'B1000000')).toBe(2000000);
    expect(sheet.stats.inputs).toBe(1);
  });
  it('validates a transaction atomically and checks revisions', () => {
    const sheet = engine({ A1: 1 });
    const session = new EngineSession(sheet);
    expect(() => session.mutate(cells(cell(0, 0, 2), cell(-1, 0, 3)), rev(0))).toThrow();
    expect(at(sheet, 'A1')).toBe(1);
    session.mutate(cells(cell(0, 0, 2)), rev(0));
    expect(() => session.mutate(cells(), rev(0))).toThrow('Revision conflict');
  });
  it('shares identical absolute aggregates across a calculated column and invalidates them together', () => {
    const sheet = new FormulaEngine({
      rows: 1000000,
      columns: 2,
      readInput: ({ col }) => (col === 0 ? 1 : null),
      columnFormulas: { 1: '=SUM($A$1:$A$1000000)' },
    });
    for (let row = 0; row < 64; row++) expect(sheet.value(a(row, 1))).toBe(1000000);
    expect(sheet.evaluations).toBe(1);
    sheet.apply(cells(cell(999999, 0, 2)));
    expect(sheet.value(a(0, 1))).toBe(1000001);
    expect(sheet.value(a(63, 1))).toBe(1000001);
    expect(sheet.evaluations).toBe(2);
  });
});
describe('clipboard', () => {
  it('shifts mixed references without modifying quoted strings', () => {
    expect(shiftFormula('=SUM(A1:$B2)+C$3+$D$4+"A1"', 2, 3)).toBe('=SUM(D3:$B4)+F$3+$D$4+"A1"');
    expect(shiftFormula('=A1', -1, 0)).toBe('=#REF!');
  });
  it('roundtrips TSV including multiline fields and doubled quotes', () => {
    const data = [
      ['hello\tworld', 'a"b', 'line1\nline2', ''],
      ['x', '', '', ''],
    ];
    expect(decodeTSV(encodeTSV(data))).toEqual(data);
    expect(decodeTSV('1\t2\r\n3\t4\r\n')).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
  });
  it('copies values externally and relative formulas internally', () => {
    const copy = copyRange(range(0, 1), () => ({
      input: '=A1+$A$1',
      value: 4,
      status: 'ready',
    }));
    expect(copy.tsv).toBe('4');
    expect(pasteCells('4', a(2, 2), copy)[0]?.input).toBe('=B3+$A$1');
    expect(pasteCells('5', a(2, 2), copy)[0]?.input).toBe(5);
  });
});
