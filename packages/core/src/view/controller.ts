import { invariant } from '../assert';
import { ViewRevision } from '../brand';
import type { Address, CanonicalAddress, LogicalAddress } from '../coords';
import { Emitter, type Unsubscribe } from '../emitter';
import { SheetError } from '../errors';
import { ViewAxis } from './axis';
import { changeView, type ViewChange } from './change';
import { validateViewState } from './parse';
import type { SheetViewState } from './state';

/** Owns the current view document and its axis mappings. */
export class ViewController {
  private emitter = new Emitter();
  rows: ViewAxis<'row'>;
  columns: ViewAxis<'col'>;
  constructor(
    private state: SheetViewState,
    private onChange?: ((state: SheetViewState) => void) | undefined,
  ) {
    validateViewState(state);
    this.rows = new ViewAxis(state.rows);
    this.columns = new ViewAxis(state.columns);
  }
  getSnapshot = (): SheetViewState => this.state;
  subscribe = (listener: () => void): Unsubscribe => this.emitter.subscribe(listener);
  replace(next: SheetViewState) {
    validateViewState(next);
    if (
      next.sourceId !== this.state.sourceId ||
      next.viewId !== this.state.viewId ||
      next.sourceRows !== this.state.sourceRows ||
      next.sourceColumns !== this.state.sourceColumns
    )
      throw new SheetError('INVALID_DOCUMENT', 'View belongs to a different source');
    this.state = { ...next, revision: ViewRevision.next(this.state.revision) };
    if (this.rows.state !== this.state.rows) this.rows = new ViewAxis(this.state.rows);
    if (this.columns.state !== this.state.columns) this.columns = new ViewAxis(this.state.columns);
    this.onChange?.(this.state);
    this.emitter.emit();
  }
  /** Applies a query result; `undefined` removes the projection. */
  setProjection(rows?: Uint32Array) {
    if (this.rows.state !== this.state.rows || this.rows.projection !== rows)
      this.rows = new ViewAxis(this.state.rows, rows);
  }
  change(change: ViewChange) {
    const next = changeView(this.state, change);
    if (next !== this.state) this.replace(next);
  }
  canonical(address: Address): CanonicalAddress {
    return { row: this.rows.canonicalAt(address.row), col: this.columns.canonicalAt(address.col) };
  }
  /** Visible positions are always present in the logical order. */
  logical(address: Address): LogicalAddress {
    const ref = this.canonical(address);
    const row = this.rows.logicalIndex(ref.row);
    const col = this.columns.logicalIndex(ref.col);
    invariant(row !== undefined && col !== undefined, 'visible item missing from view order');
    return { row, col };
  }
  /** Visible position of a canonical address, if it is currently shown. */
  visible(address: CanonicalAddress): Address | undefined {
    const row = this.rows.visibleIndex(address.row);
    const col = this.columns.visibleIndex(address.col);
    return row === undefined || col === undefined ? undefined : { row, col };
  }
  /** Visible position of a logical address, if it is currently shown. */
  fromLogical(address: LogicalAddress): Address | undefined {
    try {
      return this.visible({
        row: this.rows.canonicalAtLogical(address.row),
        col: this.columns.canonicalAtLogical(address.col),
      });
    } catch {
      return undefined;
    }
  }
}
