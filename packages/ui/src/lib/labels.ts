import type { FilterOperator, PasteMode, SortDirection } from '@sheet/core';

export const FILTER_OPERATOR_LABELS = {
  contains: 'Contains',
  equals: 'Equals',
  gt: 'Greater than',
  gte: 'At least',
  lt: 'Less than',
  lte: 'At most',
  empty: 'Is empty',
  notEmpty: 'Is not empty',
} as const satisfies Record<FilterOperator, string>;

export const SORT_DIRECTION_LABELS = {
  asc: 'Ascending',
  desc: 'Descending',
} as const satisfies Record<SortDirection, string>;

export const PASTE_MODE_LABELS = {
  all: 'Original contents',
  values: 'Values only',
  formulas: 'Formulas only',
} as const satisfies Record<PasteMode, string>;

export const PASTE_MODE_NOTES = {
  all: 'Internal copies retain formulas and adjust relative references.',
  values: 'Insert results without formulas. Text beginning with = stays text.',
  formulas: 'Only formulas overwrite cells. Other target cells stay unchanged.',
} as const satisfies Record<PasteMode, string>;

export const CURRENCIES = ['EUR', 'CZK', 'USD', 'GBP'] as const;
