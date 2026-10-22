import { useEffect, useState } from 'react';
import type { SpreadsheetState, SpreadsheetStore } from '@sheet/core';

/** Text of the "Go to cell" box; follows the active cell until the user types. */
export function useJumpAddress(
  store: SpreadsheetStore,
  state: SpreadsheetState,
): readonly [string, (value: string) => void] {
  const [jump, setJump] = useState('A1');
  const { row, col } = state.active;
  useEffect(() => {
    setJump(store.rows ? store.labelAddress(state.active) : '');
    // The label depends on the position and on the view/data revision, not the object identity.
  }, [row, col, state.viewRevision, state.revision, store]);
  return [jump, setJump];
}
