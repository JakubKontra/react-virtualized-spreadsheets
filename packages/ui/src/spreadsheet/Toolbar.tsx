import type { ReactNode } from 'react';
import { Table2 } from 'lucide-react';
import type { SpreadsheetStore } from '@sheet/core';
import type { SpreadsheetController } from '@sheet/react';
import { Separator } from '../components/separator';
import { HistoryActions } from './HistoryActions';

export interface ToolbarProps {
  readonly store: SpreadsheetStore;
  readonly sheet: SpreadsheetController;
  readonly label: string;
  /** Host content after the history actions. */
  readonly children?: ReactNode;
}

export function Toolbar({ store, sheet, label, children }: ToolbarProps) {
  const { state } = sheet;
  return (
    <div className="sheet-toolbar">
      <div className="sheet-title">
        <Table2 size={18} aria-hidden="true" />
        <strong>{label}</strong>
        <span className="badge">{store.source.mode === 'remote' ? 'LIVE DATA' : 'WORKBOOK'}</span>
      </div>
      <div className="toolbar-actions">
        <HistoryActions
          store={store}
          commit={sheet.edit.commit}
          canUndo={state.canUndo}
          canRedo={state.canRedo}
          pending={state.pending}
        />
        <Separator orientation="vertical" className="h-5 mx-1" />
        {children}
      </div>
    </div>
  );
}
