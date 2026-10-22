import type { RefObject } from 'react';
import type { SpreadsheetStore } from '@sheet/core';
import type { SpreadsheetController } from '@sheet/react';
import { DragPreview } from './DragPreview';
import { HeaderMenu } from './HeaderMenu';

export interface ViewControlsProps {
  readonly sheet: SpreadsheetController;
  readonly store: SpreadsheetStore;
  readonly scrollRef: RefObject<HTMLDivElement | null>;
}

/** Structural view editing: drag previews, header menus and their announcements. */
export function ViewControls({ sheet, store, scrollRef }: ViewControlsProps) {
  const { gestures } = sheet;
  if (!store.view) return null;
  return (
    <>
      <span className="sr-only" aria-live="polite">
        {gestures.announcement}
      </span>
      {gestures.preview && <DragPreview preview={gestures.preview} />}
      {gestures.menu && (
        <HeaderMenu
          key={`${gestures.menu.axis}:${gestures.menu.index}`}
          sheet={sheet}
          view={store.view}
          menu={gestures.menu}
          scrollRef={scrollRef}
        />
      )}
    </>
  );
}
