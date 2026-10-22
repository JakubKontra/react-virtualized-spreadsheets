import { assertNever, type SpreadsheetStore } from '@sheet/core';
import type { SpreadsheetPersistence, SpreadsheetSaveStatus } from '../types';

export interface SaveStatusProps {
  readonly store: SpreadsheetStore;
  readonly persistence: SpreadsheetPersistence;
  readonly status: SpreadsheetSaveStatus;
}

function saveText(status: SpreadsheetSaveStatus): string {
  switch (status.status) {
    case 'saved':
      return 'View saved';
    case 'saving':
      return 'Saving view…';
    case 'unsaved':
      return 'Unsaved view';
    case 'error':
      return 'View not saved';
    default:
      return assertNever(status, 'Unknown save status');
  }
}

export function SaveStatus({ store, persistence, status }: SaveStatusProps) {
  return (
    <span className="revision" role="status">
      {saveText(status)}{' '}
      {status.status === 'error' && (
        <button
          onClick={() => {
            persistence.flush().catch((error: unknown) => store.setError(error));
          }}
          title={status.error}
        >
          Retry save
        </button>
      )}
    </span>
  );
}
