import { isFormula, type CellInput, type Formula } from '../cell';
import { columnLabel } from '../coords';
import { reference } from './parse';
import { tokenize } from './tokenize';

/**
 * Moves relative references by the given offsets, as when copying a formula.
 * References shifted before the first row or column become `#REF!`.
 */
export function shiftFormula(formula: Formula, rows: number, cols: number): Formula {
  try {
    const source = formula.slice(1);
    let result = '';
    let last = 0;
    for (const token of tokenize(source)) {
      if (token.kind !== 'ref') continue;
      const ref = reference(token.text);
      const row = ref.address.row + (ref.fixedRow ? 0 : rows);
      const col = ref.address.col + (ref.fixedCol ? 0 : cols);
      const text =
        row < 0 || col < 0
          ? '#REF!'
          : `${ref.fixedCol ? '$' : ''}${columnLabel(col)}${ref.fixedRow ? '$' : ''}${row + 1}`;
      result += source.slice(last, token.start) + text;
      last = token.end;
    }
    return `=${result}${source.slice(last)}`;
  } catch {
    return formula;
  }
}

/** Shifts formulas and leaves every other input unchanged. */
export function shiftInput(input: CellInput, rows: number, cols: number): CellInput {
  return isFormula(input) ? shiftFormula(input, rows, cols) : input;
}
