import type { SpreadsheetStore, ViewController } from '@sheet/core';

export interface PanelProps {
  readonly store: SpreadsheetStore;
  readonly close: () => void;
}
export interface ViewPanelProps extends PanelProps {
  readonly view: ViewController;
}
