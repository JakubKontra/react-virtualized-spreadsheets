import { useId, type RefObject } from 'react';
import type { Address, SpreadsheetStore } from '@sheet/core';
import type { CellRect, EditorProps } from '@sheet/react';

export interface CellEditorProps {
  readonly store: SpreadsheetStore;
  readonly address: Address;
  readonly props: EditorProps;
  readonly rect: CellRect;
  readonly inputRef: RefObject<HTMLInputElement | null>;
  /** Formula assist popup describing the editor, when shown. */
  readonly describedBy: string | undefined;
}

/** In-cell editor: a date picker for date columns and suggestions for select columns. */
export function CellEditor({
  store,
  address,
  props,
  rect,
  inputRef,
  describedBy,
}: CellEditorProps) {
  const choicesId = useId();
  const option = store.columnOptions(address.col);
  const choices = option?.kind === 'select' ? option.options : null;
  return (
    <>
      <input
        {...props}
        aria-describedby={describedBy}
        type={option?.kind === 'date' ? 'date' : 'text'}
        list={choices ? choicesId : undefined}
        ref={inputRef}
        className="cell-editor"
        style={rect}
        spellCheck={false}
      />
      {choices && (
        <datalist id={choicesId}>
          {choices.map((choice) => (
            <option key={choice} value={choice} />
          ))}
        </datalist>
      )}
    </>
  );
}
