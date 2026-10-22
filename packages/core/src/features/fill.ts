import { isFormula, type CellInput, type CellPatch } from '../cell';
import { Address, CellRange, sameSpace, type LogicalAddress } from '../coords';
import { SheetError } from '../errors';
import { shiftFormula } from '../formula';
import { LIMITS } from '../limits';
import { isIsoDate } from './input';

const DAY_MS = 86_400_000;

/** How a fill extends one line of source values. */
type FillPattern =
  | { readonly kind: 'repeat'; readonly values: readonly CellInput[] }
  | {
      readonly kind: 'numeric';
      readonly values: readonly CellInput[];
      readonly base: number;
      readonly step: number;
    }
  | {
      readonly kind: 'date';
      readonly values: readonly CellInput[];
      readonly base: number;
      readonly step: number;
    };

const allNumbers = (values: readonly CellInput[]): values is readonly number[] =>
  values.every((v) => typeof v === 'number');
const allDates = (values: readonly CellInput[]): values is readonly string[] =>
  values.every((v) => typeof v === 'string' && isIsoDate(v));

function detectPattern(values: readonly CellInput[]): FillPattern {
  if (values.length >= 2 && allNumbers(values)) {
    const [first = 0, second = 0] = values;
    const step = second - first;
    if (values.every((v, i) => Math.abs(v - first - i * step) < 1e-8))
      return { kind: 'numeric', values, base: first, step };
  } else if (allDates(values)) {
    const times = values.map((v) => Date.parse(v));
    const [first = 0, second = 0] = times;
    const step = times.length === 1 ? DAY_MS : second - first;
    if (times.every((v, i) => v - first === i * step))
      return { kind: 'date', values, base: first, step };
  }
  return { kind: 'repeat', values };
}

/** Repeat a pattern, extrapolate numbers/dates, and rebase formulas using logical positions. */
export function createFillPatches(
  source: CellRange,
  target: CellRange,
  read: (a: Address) => CellInput,
  logical: (a: Address) => LogicalAddress = sameSpace,
): CellPatch[] {
  source = CellRange.normalize(source);
  target = CellRange.normalize(target);
  if (!CellRange.contains(target, source.start) || !CellRange.contains(target, source.end))
    throw new SheetError('INVALID_INPUT', 'Fill must include the source selection');
  const vertical = target.start.col === source.start.col && target.end.col === source.end.col;
  const horizontal = target.start.row === source.start.row && target.end.row === source.end.row;
  if (!vertical && !horizontal)
    throw new SheetError('INVALID_INPUT', 'Fill in one direction at a time');
  if (CellRange.size(target) > LIMITS.maxEditCells)
    throw new SheetError('LIMIT_EXCEEDED', 'Fill at most 10,000 cells');
  const length = vertical ? CellRange.rows(source) : CellRange.columns(source);
  const patches: CellPatch[] = [];
  const lines = new Map<number, FillPattern>();
  for (let row = target.start.row; row <= target.end.row; row++)
    for (let col = target.start.col; col <= target.end.col; col++) {
      const address = Address.unsafe(row, col);
      if (CellRange.contains(source, address)) continue;
      const offset = vertical ? row - source.start.row : col - source.start.col;
      const index = ((offset % length) + length) % length;
      const first = vertical
        ? Address.unsafe(source.start.row, col)
        : Address.unsafe(row, source.start.col);
      const key = vertical ? col : row;
      let pattern = lines.get(key);
      if (!pattern) {
        pattern = detectPattern(
          Array.from({ length }, (_, i) =>
            read(Address.offset(first, vertical ? i : 0, vertical ? 0 : i)),
          ),
        );
        lines.set(key, pattern);
      }
      let input = pattern.values[index] ?? null;
      if (isFormula(input)) {
        const origin = Address.offset(first, vertical ? index : 0, vertical ? 0 : index);
        const from = logical(origin);
        const to = logical(address);
        input = shiftFormula(input, to.row - from.row, to.col - from.col);
      } else if (pattern.kind === 'numeric') input = pattern.base + offset * pattern.step;
      else if (pattern.kind === 'date')
        input = new Date(pattern.base + offset * pattern.step).toISOString().slice(0, 10);
      patches.push({ ...address, input });
    }
  return patches;
}
