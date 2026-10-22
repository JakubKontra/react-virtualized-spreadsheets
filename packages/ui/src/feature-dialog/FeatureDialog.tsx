import type { RefObject } from 'react';
import { assertNever, type SpreadsheetStore } from '@sheet/core';
import { Button } from '../components/button';
import { Dialog, DialogContent, DialogTitle } from '../components/dialog';
import { FormatPanel } from './FormatPanel';
import { FreezePanel } from './FreezePanel';
import { PANEL_TITLES, type PanelRequest } from './panels';
import { PastePanel } from './PastePanel';
import { QueryPanel } from './QueryPanel';
import { ViewsPanel } from './ViewsPanel';

export interface FeatureDialogProps {
  readonly request: PanelRequest;
  readonly store: SpreadsheetStore;
  readonly close: () => void;
  /** Receives focus when the dialog closes. */
  readonly trigger: RefObject<HTMLButtonElement | null>;
}

/** Loaded lazily: the settings panels are not needed for the first paint. */
export default function FeatureDialog({ request, store, close, trigger }: FeatureDialogProps) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent className="feature-dialog" showCloseButton={false} finalFocus={trigger}>
        <div className="feature-content">
          <div className="feature-heading">
            <DialogTitle>{PANEL_TITLES[request.panel]}</DialogTitle>
            <Button variant="outline" aria-label="Close settings" onClick={close}>
              ×
            </Button>
          </div>
          <PanelBody request={request} store={store} close={close} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PanelBody({
  request,
  store,
  close,
}: Pick<FeatureDialogProps, 'request' | 'store' | 'close'>) {
  switch (request.panel) {
    case 'query':
      return <QueryPanel store={store} view={request.view} close={close} />;
    case 'format':
      return <FormatPanel store={store} view={request.view} close={close} />;
    case 'freeze':
      return <FreezePanel store={store} view={request.view} close={close} />;
    case 'paste':
      return <PastePanel store={store} close={close} />;
    case 'views':
      return <ViewsPanel store={store} view={request.view} saved={request.saved} close={close} />;
    default:
      return assertNever(request, 'Unknown panel');
  }
}
