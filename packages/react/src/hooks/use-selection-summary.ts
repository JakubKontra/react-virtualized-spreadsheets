import { useEffect, useState } from 'react';
import { errorMessage, type CellRange, type Revision, type SpreadsheetStore } from '@sheet/core';
import type { SelectionSummaryState } from '../types';

const SUMMARY_DELAY_MS = 200;
const IDLE: SelectionSummaryState = { status: 'idle' };

export interface UseSelectionSummaryOptions {
  readonly range: CellRange;
  /** Recompute when the data revision changes. */
  readonly revision: Revision;
  /** Summaries are paused while false (for example during a query). */
  readonly enabled?: boolean | undefined;
}

/** Asks the source for a debounced summary of the selection, when it supports one. */
export function useSelectionSummary(
  store: SpreadsheetStore,
  { range, revision, enabled = true }: UseSelectionSummaryOptions,
): SelectionSummaryState {
  const [state, setState] = useState<SelectionSummaryState>(IDLE);
  const { start, end } = range;
  useEffect(() => {
    const summary = store.source.summary;
    if (!summary || !store.rows || !enabled) {
      setState(IDLE);
      return;
    }
    const controller = new AbortController();
    setState({ status: 'loading' });
    const timer = setTimeout(() => {
      summary(range, controller.signal).then(
        (value) => {
          if (!controller.signal.aborted) setState({ status: 'ready', value });
        },
        (error: unknown) => {
          if (!controller.signal.aborted) setState({ status: 'error', error: errorMessage(error) });
        },
      );
    }, SUMMARY_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // The range is compared by its coordinates, not identity.
  }, [store, start.row, start.col, end.row, end.col, revision, enabled]);
  return state;
}
