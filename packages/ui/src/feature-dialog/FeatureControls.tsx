import { lazy, memo, Suspense, useRef, useState } from 'react';
import { hasQuery, type SheetViewState, type SpreadsheetStore } from '@sheet/core';
import type { EditSession } from '@sheet/react';
import { Button } from '../components/button';
import { availablePanels, panelButtonLabel, type PanelRequest, type SavedViews } from './panels';

const FeatureDialog = lazy(() => import('./FeatureDialog'));

export interface FeatureControlsProps {
  readonly store: SpreadsheetStore;
  readonly commit: EditSession['commit'];
  /** The current view document; a new snapshot re-renders the trigger labels. */
  readonly settings: SheetViewState | undefined;
  readonly saved: SavedViews | undefined;
}

export const FeatureControls = memo(function FeatureControls({
  store,
  commit,
  settings,
  saved,
}: FeatureControlsProps) {
  const [open, setOpen] = useState<PanelRequest | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const close = () => setOpen(null);
  return (
    <>
      <div className="feature-actions">
        {availablePanels(store, saved).map((request) => (
          <Button
            variant="outline"
            key={request.panel}
            aria-haspopup="dialog"
            onClick={(event) => {
              trigger.current = event.currentTarget;
              void commit({ restoreFocus: false }).then((ok) => {
                if (ok) setOpen(request);
              });
            }}
          >
            {panelButtonLabel(request.panel, settings)}
            {request.panel === 'query' && hasQuery(settings?.query) ? ' •' : ''}
          </Button>
        ))}
      </div>
      {open && (
        <Suspense
          fallback={
            <span className="sr-only" role="status">
              Opening settings…
            </span>
          }
        >
          <FeatureDialog request={open} store={store} close={close} trigger={trigger} />
        </Suspense>
      )}
    </>
  );
});
