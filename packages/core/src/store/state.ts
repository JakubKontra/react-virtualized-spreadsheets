import type { Revision, ViewRevision } from '../brand';
import type { Address, CellRange } from '../coords';
import type { ConnectionState } from '../source';

export type SelectionKind = 'cells' | 'rows' | 'columns' | 'all';
/** Where a draft is being typed: in the cell itself or in the formula bar. */
export type EditorTarget = 'cell' | 'bar';

export interface SpreadsheetState {
  readonly selection: CellRange;
  readonly selectionKind: SelectionKind;
  readonly active: Address;
  readonly editing: Address | null;
  readonly draft: string | null;
  readonly editor: EditorTarget;
  readonly viewRevision: ViewRevision;
  readonly connection: ConnectionState;
  /** A mutation is in flight. */
  readonly pending: boolean;
  /** A view query is running; selection and edits are paused. */
  readonly querying: boolean;
  /** Blocks currently loading. */
  readonly loading: number;
  readonly error: string | null;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly revision: Revision;
}
