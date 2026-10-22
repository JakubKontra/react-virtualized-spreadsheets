import { createContext, useContext } from 'react';
import type { ColumnLabelResolver } from './lib/column-labels';

export interface SheetContextValue {
  /** Container for popups that must escape the grid's overflow. */
  readonly portal: HTMLDivElement | null;
  readonly getColumnLabel?: ColumnLabelResolver | undefined;
}
export const SheetContext = createContext<SheetContextValue>({ portal: null });
export const useSheetPortal = (): HTMLDivElement | null => useContext(SheetContext).portal;
export const useColumnLabelResolver = (): ColumnLabelResolver | undefined =>
  useContext(SheetContext).getColumnLabel;
