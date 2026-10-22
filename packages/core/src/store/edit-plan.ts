import {
  isFormula,
  type CellInput,
  type CellPatch,
  type CellSnapshot,
  type ColumnFormulaPatch,
  type Formula,
} from '../cell';
import { cellKey, type Address, type ColIndex } from '../coords';
import { SheetError } from '../errors';
import { shiftFormula } from '../formula';
import type { Mutation } from '../source';

export interface EditPlan {
  readonly forward: Mutation;
  readonly backward: Mutation;
}

/** Later patches to the same cell win. */
export const uniquePatches = (patches: readonly CellPatch[]): CellPatch[] => [
  ...new Map(patches.map((patch) => [cellKey(patch), patch])).values(),
];

/** The first-row template of a calculated column whose cell at `address` holds `input`. */
export function columnTemplate(input: CellInput, address: Address): Formula | null {
  if (input === null) return null;
  if (!isFormula(input))
    throw new SheetError('INVALID_INPUT', 'Calculated columns require formulas starting with =');
  return shiftFormula(input, -address.row, 0);
}

/**
 * A remote source without a view stores calculated columns only: each edited column becomes one
 * formula template, and every cell of the column must agree on it.
 */
export function planColumnEdit(
  patches: readonly CellPatch[],
  currentFormula: (col: ColIndex) => Formula | null,
): EditPlan {
  const columns = new Map<ColIndex, Formula | null>();
  for (const patch of patches) {
    const formula = columnTemplate(patch.input, patch);
    const previous = columns.get(patch.col);
    if (previous !== undefined && previous !== formula)
      throw new SheetError(
        'INVALID_INPUT',
        'Each server column must use one consistent formula template',
      );
    columns.set(patch.col, formula);
  }
  const forward: ColumnFormulaPatch[] = [...columns].map(([col, formula]) => ({ col, formula }));
  const backward: ColumnFormulaPatch[] = [...columns.keys()].map((col) => ({
    col,
    formula: currentFormula(col),
  }));
  return {
    forward: { kind: 'columns', columns: forward },
    backward: { kind: 'columns', columns: backward },
  };
}

/** Cell edits are undone by restoring the inputs that were loaded before the edit. */
export function planCellEdit(
  patches: readonly CellPatch[],
  read: (address: Address) => CellSnapshot,
): EditPlan {
  const before: CellPatch[] = patches.map((patch) => {
    const previous = read(patch);
    if (previous.status === 'loading' || previous.status === 'calculating')
      throw new SheetError('BUSY', 'Load the target cells before editing');
    return { row: patch.row, col: patch.col, input: previous.input };
  });
  return {
    forward: { kind: 'cells', cells: patches },
    backward: { kind: 'cells', cells: before },
  };
}
