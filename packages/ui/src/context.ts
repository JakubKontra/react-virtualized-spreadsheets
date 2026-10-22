import { createContext, useContext } from 'react';
export const SheetContext = createContext<{
  portal: HTMLDivElement | null;
  getColumnLabel?: (canonicalColumn: number) => string | undefined;
}>({ portal: null });
export const useSheetPortal = () => useContext(SheetContext).portal;
