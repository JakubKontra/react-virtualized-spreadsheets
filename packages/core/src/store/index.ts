export type { SpreadsheetState, SelectionKind, EditorTarget } from './state';
export type { CacheOptions, CacheStats } from './block-cache';
export type { HistoryEntry } from './history';
export {
  planCellEdit,
  planColumnEdit,
  columnTemplate,
  uniquePatches,
  type EditPlan,
} from './edit-plan';
export {
  createSpreadsheet,
  SpreadsheetStore,
  type SpreadsheetOptions,
  type ViewOptions,
  type CommitResult,
} from './spreadsheet-store';
