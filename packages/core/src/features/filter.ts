import { isError, type CellValue } from '../cell';
import type { ColumnFilter } from './settings';

export function matchesFilter(value: CellValue, filter: ColumnFilter): boolean {
  switch (filter.operator) {
    case 'empty':
      return value === null || value === '';
    case 'notEmpty':
      return value !== null && value !== '';
  }
  if (isError(value) || value === null) return false;
  const expected = filter.value;
  switch (filter.operator) {
    case 'contains':
      return String(value).toLocaleLowerCase().includes(String(expected).toLocaleLowerCase());
    case 'equals':
      return String(value).toLocaleLowerCase() === String(expected).toLocaleLowerCase();
  }
  const bound = Number(expected);
  if (typeof value !== 'number' || !Number.isFinite(bound)) return false;
  switch (filter.operator) {
    case 'gt':
      return value > bound;
    case 'gte':
      return value >= bound;
    case 'lt':
      return value < bound;
    case 'lte':
      return value <= bound;
  }
}
