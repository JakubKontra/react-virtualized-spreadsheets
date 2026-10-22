import { memo } from 'react';
import { Undo2, Redo2 } from 'lucide-react';
import type { SpreadsheetStore } from '@sheet/core';
import type { SpreadsheetController } from './types';
import { Button } from './components/button';
import { Tooltip, TooltipContent, TooltipTrigger } from './components/tooltip';

export const HistoryActions = memo(function HistoryActions({
  store,
  commitEdit,
  canUndo,
  canRedo,
  pending,
}: {
  store: SpreadsheetStore;
  commitEdit: SpreadsheetController['commitEdit'];
  canUndo: boolean;
  canRedo: boolean;
  pending: boolean;
}) {
  return (
    <>
      {(['undo', 'redo'] as const).map((action) => (
        <Tooltip key={action}>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={action === 'undo' ? 'Undo' : 'Redo'}
                disabled={pending || !(action === 'undo' ? canUndo : canRedo)}
                onClick={() => {
                  void commitEdit()
                    .then(async (ok) => {
                      if (ok) await store[action]();
                    })
                    .catch((error) => store.setError(error));
                }}
              />
            }
          >
            {action === 'undo' ? <Undo2 size={16} /> : <Redo2 size={16} />}
          </TooltipTrigger>
          <TooltipContent>
            {action === 'undo' ? 'Undo (Ctrl/⌘ Z)' : 'Redo (Ctrl/⌘ Shift Z)'}
          </TooltipContent>
        </Tooltip>
      ))}
    </>
  );
});
