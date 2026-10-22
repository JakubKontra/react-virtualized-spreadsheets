import type { ColumnOptions, CurrencyCode } from '@sheet/core';

/** Sets decimals on kinds that have them; other kinds are returned unchanged. */
export function withDecimals(option: ColumnOptions, decimals: number): ColumnOptions {
  switch (option.kind) {
    case 'number':
    case 'percent':
    case 'currency':
      return { ...option, decimals };
    case 'auto':
    case 'text':
    case 'date':
    case 'checkbox':
    case 'select':
      return option;
  }
}

export function withCurrency(option: ColumnOptions, currency: CurrencyCode): ColumnOptions {
  return option.kind === 'currency' ? { ...option, currency } : option;
}

/** Choices are edited one per line. */
export function withChoices(option: ColumnOptions, text: string): ColumnOptions {
  return option.kind === 'select' ? { ...option, options: text.split('\n') } : option;
}
