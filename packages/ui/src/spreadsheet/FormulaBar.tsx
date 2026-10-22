import type { RefObject } from 'react';
import { columnLabel, type SpreadsheetStore } from '@sheet/core';
import type { SpreadsheetController } from '@sheet/react';
import { useJumpAddress } from './hooks/use-jump-address';

export interface FormulaBarProps {
  readonly store: SpreadsheetStore;
  readonly sheet: SpreadsheetController;
  readonly scrollRef: RefObject<HTMLDivElement | null>;
  readonly inputRef: RefObject<HTMLInputElement | null>;
  /** Formula assist popup describing the bar, when shown. */
  readonly assistId: string | undefined;
}

export function FormulaBar({ store, sheet, scrollRef, inputRef, assistId }: FormulaBarProps) {
  const [jump, setJump] = useJumpAddress(store, sheet.state);
  const active = sheet.state.active;
  const isRemote = store.source.mode === 'remote';
  const view = store.view;
  const columnFormula =
    isRemote &&
    store.rows > 0 &&
    view !== undefined &&
    view.columns.isOwned(active.col) &&
    !view.rows.isOwned(active.row);
  return (
    <div className="formula-bar">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const address = store.resolveAddress(jump);
          if (!address) {
            store.setError(new Error('Enter an address such as A100'));
            return;
          }
          try {
            sheet.navigation.select(address);
            scrollRef.current?.focus();
          } catch (error) {
            store.setError(error);
          }
        }}
      >
        <input
          aria-label="Go to cell"
          value={jump}
          onChange={(event) => setJump(event.target.value)}
          spellCheck={false}
        />
        <span>⌄</span>
      </form>
      <span className="formula-symbol">ƒx</span>
      <input
        {...sheet.props.formulaBar}
        ref={inputRef}
        aria-describedby={assistId}
        placeholder={
          isRemote
            ? 'Select a calculated column to write a formula'
            : 'Select a cell or write a formula, e.g. =SUM(A1:A10)'
        }
        spellCheck={false}
      />
      {columnFormula && (
        <span className="formula-hint">
          Applies to column {columnLabel(store.logicalAddress(active).col)}
        </span>
      )}
    </div>
  );
}
