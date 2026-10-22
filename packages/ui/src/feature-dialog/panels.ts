import {
  assertNever,
  type SheetViewState,
  type SpreadsheetStore,
  type ViewController,
  type ViewId,
} from '@sheet/core';
import type { SpreadsheetPersistence, SpreadsheetViewAdapter } from '../types';

export const FEATURE_PANELS = ['query', 'format', 'freeze', 'paste', 'views'] as const;
export type FeaturePanel = (typeof FEATURE_PANELS)[number];
/** Panels that edit view settings and therefore need a configured view. */
export type ViewSettingsPanel = Extract<FeaturePanel, 'query' | 'format' | 'freeze'>;

export const PANEL_TITLES = {
  query: 'Sort, filter & search',
  format: 'Column format',
  freeze: 'Freeze panes',
  paste: 'Paste special',
  views: 'Saved views',
} as const satisfies Record<FeaturePanel, string>;

/** A view adapter that can list saved views. */
export type ViewCatalog = Required<Pick<SpreadsheetViewAdapter, 'list'>> &
  Pick<SpreadsheetViewAdapter, 'save'>;

/** Everything the saved-views panel needs; only offered when the host provides all of it. */
export interface SavedViews {
  readonly persistence: SpreadsheetPersistence;
  readonly catalog: ViewCatalog;
  readonly onSwitchView: (viewId: ViewId) => Promise<void>;
}

export const isViewCatalog = (adapter: SpreadsheetViewAdapter): adapter is ViewCatalog =>
  adapter.list !== undefined;

/** What a panel needs, by panel: view panels get a non-null view controller. */
export type PanelRequest =
  | { readonly panel: 'paste' }
  | { readonly panel: ViewSettingsPanel; readonly view: ViewController }
  | { readonly panel: 'views'; readonly view: ViewController; readonly saved: SavedViews };

/** The panels available for a store, in toolbar order. */
export function availablePanels(
  store: SpreadsheetStore,
  saved: SavedViews | undefined,
): PanelRequest[] {
  const view = store.view;
  const requests: PanelRequest[] = [];
  for (const panel of FEATURE_PANELS) {
    switch (panel) {
      case 'paste':
        requests.push({ panel });
        break;
      case 'query':
      case 'format':
      case 'freeze':
        if (view) requests.push({ panel, view });
        break;
      case 'views':
        if (view && saved) requests.push({ panel, view, saved });
        break;
      default:
        assertNever(panel, 'Unknown panel');
    }
  }
  return requests;
}

/** Toolbar label of a panel's trigger; the views trigger shows the current view's name. */
export function panelButtonLabel(
  panel: FeaturePanel,
  settings: SheetViewState | undefined,
): string {
  switch (panel) {
    case 'query':
      return 'Sort & filter';
    case 'format':
      return 'Format';
    case 'freeze':
      return 'Freeze';
    case 'paste':
      return 'Paste special';
    case 'views':
      return settings?.name ?? 'Views';
    default:
      return assertNever(panel, 'Unknown panel');
  }
}
