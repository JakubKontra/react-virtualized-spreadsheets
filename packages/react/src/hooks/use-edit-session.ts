import { useRef, type RefObject } from 'react';
import { Address, type SpreadsheetState, type SpreadsheetStore } from '@sheet/core';
import type {
  CommitEditOptions,
  CommitMove,
  EditSession,
  Navigation,
  StartEditOptions,
} from '../types';
import { useStableCallback } from './use-stable-callback';

export interface UseEditSessionOptions {
  readonly store: SpreadsheetStore;
  readonly state: SpreadsheetState;
  readonly scrollRef: RefObject<HTMLElement | null>;
  readonly scrollToCell: (address: Address) => void;
}
export interface EditSessionHandle {
  readonly edit: EditSession;
  readonly navigation: Navigation;
  /** Returns focus to the grid without scrolling. */
  focus(): void;
  /** Reports a rejected promise on the store instead of throwing. */
  report(promise: Promise<unknown>): void;
}

function moveTarget(store: SpreadsheetStore, address: Address, move: CommitMove): Address | null {
  switch (move) {
    case 'none':
      return null;
    case 'down':
      return Address.unsafe(Math.min(store.rows - 1, address.row + 1), address.col);
    case 'left':
    case 'right':
      return Address.unsafe(
        address.row,
        Math.max(0, Math.min(store.columns - 1, address.col + (move === 'left' ? -1 : 1))),
      );
  }
}

/** Draft editing, commits (deduplicated while one is in flight) and selection. */
export function useEditSession({
  store,
  state,
  scrollRef,
  scrollToCell,
}: UseEditSessionOptions): EditSessionHandle {
  const committing = useRef<Promise<boolean> | null>(null);
  const focus = useStableCallback(() => scrollRef.current?.focus({ preventScroll: true }));
  const report = useStableCallback((promise: Promise<unknown>) => {
    promise.catch((error: unknown) => store.setError(error));
  });
  const commit = useStableCallback((options: CommitEditOptions = {}): Promise<boolean> => {
    if (committing.current) return committing.current;
    const snapshot = store.getSnapshot();
    const text = options.text ?? snapshot.draft ?? '';
    if (!snapshot.editing && text === '') return Promise.resolve(true);
    const address = snapshot.editing ?? snapshot.active;
    const promise = (async () => {
      try {
        await store.commitDraft(text, address);
        const next = moveTarget(store, address, options.move ?? 'none');
        if (next && !store.getSnapshot().editing) {
          store.select(next);
          scrollToCell(next);
        }
        if (options.restoreFocus ?? true) focus();
        return true;
      } catch (error) {
        store.setError(error);
        return false;
      }
    })();
    committing.current = promise;
    void promise.finally(() => {
      committing.current = null;
    });
    return promise;
  });
  const select = useStableCallback(
    (address: Address, options: { readonly extend?: boolean | undefined } = {}) => {
      store.assertAddress(address);
      const apply = () => {
        store.select(address, options.extend ?? false);
        scrollToCell(address);
      };
      if (!store.getSnapshot().editing) apply();
      else
        void commit().then((ok) => {
          if (ok) apply();
        });
    },
  );
  const start = useStableCallback((options: StartEditOptions = {}) =>
    store.beginEdit(options.address ?? store.getSnapshot().active, options.initial),
  );
  const setDraft = useStableCallback((value: string) => store.setDraft(value));
  const cancel = useStableCallback(() => store.cancelEdit());
  return {
    edit: { draft: state.draft ?? '', setDraft, start, commit, cancel },
    navigation: { select, scrollToCell },
    focus,
    report,
  };
}
