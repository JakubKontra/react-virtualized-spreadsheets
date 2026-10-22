import { Table2 } from 'lucide-react';
import type { SpreadsheetState, SpreadsheetStore } from '@sheet/core';

export interface StatusBarProps {
  readonly store: SpreadsheetStore;
  readonly state: SpreadsheetState;
  readonly label: string;
  readonly number: Intl.NumberFormat;
}

function statusText(state: SpreadsheetState, remote: boolean): string {
  if (state.connection === 'disconnected') return 'Disconnected · showing last values';
  if (state.pending) return 'Saving changes…';
  if (state.loading) return 'Calculating…';
  return remote ? 'Live connection' : 'All calculations up to date';
}

export function StatusBar({ store, state, label, number }: StatusBarProps) {
  return (
    <div className="sheet-bottom">
      <div className="sheet-tab">
        <Table2 size={14} aria-hidden="true" /> {label}
      </div>
      <div className="sheet-status" aria-live="polite">
        <span className={`status-dot ${state.connection === 'disconnected' ? 'offline' : ''}`} />
        {statusText(state, store.source.mode === 'remote')}
      </div>
      <span className="sheet-size">
        {number.format(store.rows)} rows <span>·</span> {store.columns} columns
      </span>
    </div>
  );
}
