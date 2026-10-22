import { isError, type CellValue } from '../cell';
import { DEFAULT_CURRENCY, DEFAULT_DECIMALS, decimalsOf, type ColumnOptions } from './settings';

const numberFormats = new Map<string, Intl.NumberFormat>();

export function formatCellValue(
  value: CellValue,
  option?: ColumnOptions,
  locale = 'en-GB',
): string {
  if (isError(value)) return value.error;
  if (value === null) return '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value !== 'number' || option?.kind === 'text') return String(value);
  const decimals = decimalsOf(option);
  const currency = option?.kind === 'currency' ? option.currency : undefined;
  const key = `${locale}:${option?.kind}:${decimals}:${currency}`;
  let formatter = numberFormats.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      style:
        option?.kind === 'currency'
          ? 'currency'
          : option?.kind === 'percent'
            ? 'percent'
            : 'decimal',
      currency: currency ?? DEFAULT_CURRENCY,
      maximumFractionDigits: decimals ?? DEFAULT_DECIMALS,
      ...(decimals === undefined ? {} : { minimumFractionDigits: decimals }),
    });
    if (numberFormats.size > 100) numberFormats.clear();
    numberFormats.set(key, formatter);
  }
  return formatter.format(value);
}
