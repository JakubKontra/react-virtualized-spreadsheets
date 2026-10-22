import { useMemo } from 'react';

/** Locale number formatter for headers and summaries. */
export function useNumberFormat(locale: string): Intl.NumberFormat {
  return useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }), [locale]);
}
