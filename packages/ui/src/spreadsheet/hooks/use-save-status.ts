import { useEffect, useSyncExternalStore } from 'react';
import type { SpreadsheetStore } from '@sheet/core';
import type { SpreadsheetPersistence, SpreadsheetSaveStatus } from '../../types';

const noSubscribe = () => () => {};
const noSnapshot = () => null;

/** Current save status of the host's persistence, or `null` without persistence. */
export function useSaveStatus(
  persistence: SpreadsheetPersistence | undefined,
): SpreadsheetSaveStatus | null {
  const getSnapshot = persistence?.getSnapshot ?? noSnapshot;
  return useSyncExternalStore(persistence?.subscribe ?? noSubscribe, getSnapshot, getSnapshot);
}

/** Saves when the page is hidden and warns before unloading unsaved work. */
export function useUnloadGuard(
  store: SpreadsheetStore,
  persistence: SpreadsheetPersistence | undefined,
): void {
  useEffect(() => {
    if (!persistence) return;
    const flush = () => {
      persistence.flush().catch((error: unknown) => store.setError(error));
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (persistence.getSnapshot().status !== 'saved' || store.getSnapshot().editing) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    document.addEventListener('visibilitychange', flush);
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', flush);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [persistence, store]);
}
