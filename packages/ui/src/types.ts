import type { CSSProperties, ReactNode } from 'react';
import type { SpreadsheetStore, ViewId, ViewPersistenceAdapter } from '@sheet/core';
import type { SpreadsheetController, UseSpreadsheetOptions } from '@sheet/react';
import type { ColumnLabelResolver } from './lib/column-labels';

export type { SpreadsheetController } from '@sheet/react';
export type { ColumnLabelResolver } from './lib/column-labels';

/** Structurally compatible with `ViewSaveStatus` from `@sheet/transport`. */
export type SpreadsheetSaveStatus =
  | { readonly status: 'saved' | 'saving' | 'unsaved'; readonly error: null }
  | { readonly status: 'error'; readonly error: string };

/** Compatible with `ViewPersistenceBinding`; the host owns its lifecycle. */
export interface SpreadsheetPersistence {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => SpreadsheetSaveStatus;
  flush(): Promise<void>;
}

/** The parts of a view adapter the saved-views panel uses. */
export type SpreadsheetViewAdapter = Pick<ViewPersistenceAdapter, 'list' | 'save'>;

export interface SpreadsheetProps {
  /** Created and disposed by the host. */
  readonly store: SpreadsheetStore;
  readonly title?: string | undefined;
  /** Scroll viewport height, default 480px. */
  readonly height?: CSSProperties['height'] | undefined;
  readonly locale?: string | undefined;
  readonly className?: string | undefined;
  /** Receives the stable canonical column index, including after reordering. */
  readonly getColumnLabel?: ColumnLabelResolver | undefined;
  readonly columnWidth?: UseSpreadsheetOptions['columnWidth'];
  readonly renderToolbar?: ((sheet: SpreadsheetController) => ReactNode) | undefined;
  readonly persistence?: SpreadsheetPersistence | undefined;
  readonly views?: SpreadsheetViewAdapter | undefined;
  readonly onSwitchView?: ((viewId: ViewId) => Promise<void>) | undefined;
}
