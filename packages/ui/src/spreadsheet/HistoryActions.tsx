import { memo, type ReactNode } from 'react';
import { Redo2, Undo2 } from 'lucide-react';
import type { SpreadsheetStore } from '@sheet/core';
import type { EditSession } from '@sheet/react';
import { Button } from '../components/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/tooltip';

type HistoryAction = 'undo' | 'redo';

const ACTIONS = {
  undo: { label: 'Undo', hint: 'Undo (Ctrl/⌘ Z)', icon: <Undo2 size={16} /> },
  redo: { label: 'Redo', hint: 'Redo (Ctrl/⌘ Shift Z)', icon: <Redo2 size={16} /> },
} as const satisfies Record<HistoryAction, { label: string; hint: string; icon: ReactNode }>;

export interface HistoryActionsProps {
  readonly store: SpreadsheetStore;
  readonly commit: EditSession['commit'];
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly pending: boolean;
}

export const HistoryActions = memo(function HistoryActions({
  store,
  commit,
  canUndo,
  canRedo,
  pending,
}: HistoryActionsProps) {
  const enabled = { undo: canUndo, redo: canRedo } satisfies Record<HistoryAction, boolean>;
  return (
    <>
      {(['undo', 'redo'] as const).map((action) => (
        <Tooltip key={action}>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={ACTIONS[action].label}
                disabled={pending || !enabled[action]}
                onClick={() => {
                  commit()
                    .then(async (ok) => {
                      if (ok) await store[action]();
                    })
                    .catch((error: unknown) => store.setError(error));
                }}
              />
            }
          >
            {ACTIONS[action].icon}
          </TooltipTrigger>
          <TooltipContent>{ACTIONS[action].hint}</TooltipContent>
        </Tooltip>
      ))}
    </>
  );
});
