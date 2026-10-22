import type { CSSProperties, ReactNode } from 'react';
import type { SpreadsheetStore, ViewPersistenceAdapter } from '@sheet/core';
import type { useSpreadsheet, UseSpreadsheetOptions } from '@sheet/react';

export type SpreadsheetController = ReturnType<typeof useSpreadsheet>;
export interface SpreadsheetSaveStatus {
  status: 'saved' | 'saving' | 'unsaved' | 'error';
  error: string | null;
}
/** Compatible with ViewPersistenceBinding; the host owns its lifecycle. */
export interface SpreadsheetPersistence {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => SpreadsheetSaveStatus;
  flush: () => Promise<void>;
}
export interface SpreadsheetProps {
  /** Created and disposed by the host. */
  store: SpreadsheetStore;
  title?: string;
  /** Scroll viewport height, default 480px. */
  height?: CSSProperties['height'];
  locale?: string;
  className?: string;
  /** Receives the stable canonical column index, including after reordering. */
  getColumnLabel?: (canonicalColumn: number) => string | undefined;
  columnWidth?: UseSpreadsheetOptions['columnWidth'];
  renderToolbar?: (sheet: SpreadsheetController) => ReactNode;
  persistence?: SpreadsheetPersistence;
  views?: Pick<ViewPersistenceAdapter, 'list' | 'save'>;
  onSwitchView?: (viewId: string) => Promise<void>;
}
