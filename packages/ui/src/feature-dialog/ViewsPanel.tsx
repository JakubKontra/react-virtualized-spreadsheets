import { useEffect, useState } from 'react';
import {
  errorMessage,
  LIMITS,
  ViewId,
  ViewRevision,
  type SheetViewState,
  type ViewController,
  type ViewSummary,
} from '@sheet/core';
import { Button } from '../components/button';
import { Input } from '../components/input';
import type { SpreadsheetPersistence } from '../types';
import type { SavedViews } from './panels';
import type { PanelProps } from './types';

export interface ViewsPanelProps extends PanelProps {
  readonly view: ViewController;
  readonly saved: SavedViews;
}

/** Saves pending view changes; rejects with the save error so callers can show it. */
async function flushOrThrow(persistence: SpreadsheetPersistence): Promise<void> {
  await persistence.flush();
  const status = persistence.getSnapshot();
  if (status.status === 'error') throw new Error(status.error);
}

function copyView(state: SheetViewState, name: string): SheetViewState {
  return {
    ...state,
    viewId: ViewId.unsafe(crypto.randomUUID()),
    name,
    revision: ViewRevision.initial,
  };
}

export function ViewsPanel({ store, view, saved, close }: ViewsPanelProps) {
  const { persistence, catalog, onSwitchView } = saved;
  const current = view.getSnapshot();
  const [savedViews, setSavedViews] = useState<readonly ViewSummary[]>([]);
  const [name, setName] = useState(current.name ?? 'Untitled view');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void persistence
      .flush()
      .then(() => catalog.list(view.getSnapshot().sourceId, controller.signal))
      .then((list) => {
        if (!controller.signal.aborted) setSavedViews(list);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(cause));
      });
    return () => controller.abort();
  }, [view, persistence, catalog]);
  const run = (task: () => Promise<void>) => {
    setBusy(true);
    setError('');
    void task()
      .catch((cause: unknown) => setError(errorMessage(cause)))
      .finally(() => setBusy(false));
  };
  const trimmed = name.trim();
  return (
    <div>
      <label className="stack-field">
        View name
        <Input
          autoFocus
          maxLength={LIMITS.maxViewNameLength}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <div className="dialog-actions">
        <Button
          variant="outline"
          disabled={busy || !trimmed}
          onClick={() =>
            run(async () => {
              store.configure({ name: trimmed });
              await flushOrThrow(persistence);
              close();
            })
          }
        >
          Rename current view
        </Button>
        <Button
          variant="default"
          disabled={busy || !trimmed}
          onClick={() =>
            run(async () => {
              await flushOrThrow(persistence);
              const copy = copyView(view.getSnapshot(), trimmed);
              await catalog.save(copy, null, new AbortController().signal);
              close();
              await onSwitchView(copy.viewId);
            })
          }
        >
          Save as new view
        </Button>
      </div>
      <h3>Your views</h3>
      <div className="view-list">
        {savedViews.map((summary) => {
          const isCurrent = summary.viewId === current.viewId;
          return (
            <Button
              variant="outline"
              disabled={busy || isCurrent}
              key={summary.viewId}
              onClick={() =>
                run(async () => {
                  close();
                  await onSwitchView(summary.viewId);
                })
              }
            >
              {summary.name}
              {isCurrent ? ' · current' : ' →'}
            </Button>
          );
        })}
      </div>
      <p className="settings-note">
        Each view saves its layout, query, formats, frozen panes and calculations.
      </p>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
