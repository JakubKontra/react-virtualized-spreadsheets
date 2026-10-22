import { LIMITS } from '../limits';
import type { Mutation } from '../source';
import type { SheetViewState } from '../view';

/** Data edits are undone with an inverse mutation; view edits by restoring the document. */
export type HistoryEntry =
  | { readonly kind: 'data'; readonly forward: Mutation; readonly backward: Mutation }
  | { readonly kind: 'view'; readonly before: SheetViewState; readonly after: SheetViewState };

export class History {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  constructor(private limit: number = LIMITS.historyLimit) {}
  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }
  record(entry: HistoryEntry) {
    this.undoStack.push(entry);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }
  peekUndo(): HistoryEntry | undefined {
    return this.undoStack.at(-1);
  }
  peekRedo(): HistoryEntry | undefined {
    return this.redoStack.at(-1);
  }
  /** Moves the newest undo entry to the redo stack once it was applied. */
  commitUndo() {
    const entry = this.undoStack.pop();
    if (entry) this.redoStack.push(entry);
  }
  commitRedo() {
    const entry = this.redoStack.pop();
    if (entry) this.undoStack.push(entry);
  }
  clear() {
    this.undoStack = [];
    this.redoStack = [];
  }
}
