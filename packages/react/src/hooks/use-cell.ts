import { useCallback, useSyncExternalStore } from 'react';
import {
  Address,
  type CellSnapshot,
  type SpreadsheetState,
  type SpreadsheetStore,
} from '@sheet/core';

/** Subscribes to one cell; re-renders only when that cell changes. */
export function useCell(store: SpreadsheetStore, address: Address): CellSnapshot {
  const { row, col } = address;
  const subscribe = useCallback(
    (listener: () => void) => store.subscribeCell(Address.unsafe(row, col), listener),
    [store, row, col],
  );
  const read = useCallback(() => store.readCell(Address.unsafe(row, col)), [store, row, col]);
  return useSyncExternalStore(subscribe, read, read);
}

export function useSpreadsheetState(store: SpreadsheetStore): SpreadsheetState {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
