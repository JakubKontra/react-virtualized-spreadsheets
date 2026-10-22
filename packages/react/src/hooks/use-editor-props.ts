import type { FocusEvent, KeyboardEvent } from 'react';
import type { CellSnapshot, SpreadsheetState, SpreadsheetStore } from '@sheet/core';
import { handleCaretKeys, isSheetEditor, SHEET_EDITOR_ATTRIBUTE } from '../internal/editor-keys';
import type { EditorProps, EditSession, FormulaEditorController } from '../types';

export interface UseEditorPropsOptions {
  readonly store: SpreadsheetStore;
  readonly state: SpreadsheetState;
  /** Shared by the editors of one spreadsheet so focus can move between them. */
  readonly prefix: string;
  readonly edit: EditSession;
  readonly formula: FormulaEditorController;
  readonly activeCell: CellSnapshot;
  focus(): void;
}
export interface EditorPropSet {
  readonly editor: EditorProps;
  readonly formulaBar: EditorProps;
}

/** Props for the in-cell editor and the formula bar, which share one draft. */
export function useEditorProps({
  store,
  state,
  prefix,
  edit,
  formula,
  activeCell,
  focus,
}: UseEditorPropsOptions): EditorPropSet {
  const onBlur = (event: FocusEvent<HTMLInputElement>) => {
    if (!isSheetEditor(event.relatedTarget, prefix))
      void edit.commit({ move: 'none', restoreFocus: false });
  };
  const cancel = (event: KeyboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    edit.cancel();
    focus();
  };
  const common = {
    [SHEET_EDITOR_ATTRIBUTE]: prefix,
    onSelect: formula.track,
    onBlur,
  };
  const editor: EditorProps = {
    ...common,
    'aria-label': state.editing ? `Edit ${store.labelAddress(state.editing)}` : 'Cell editor',
    value: edit.draft,
    disabled: state.pending,
    onFocus: formula.track,
    onChange(event) {
      edit.setDraft(event.target.value);
      formula.track(event);
    },
    onKeyDown(event) {
      event.stopPropagation();
      if (event.nativeEvent.isComposing || formula.onKeyDown(event)) return;
      if (handleCaretKeys(event)) {
        formula.track(event);
        return;
      }
      switch (event.key) {
        case 'Enter':
          event.preventDefault();
          void edit.commit({ text: edit.draft, move: 'down' });
          return;
        case 'Tab':
          event.preventDefault();
          void edit.commit({ move: event.shiftKey ? 'left' : 'right' });
          return;
        case 'Escape':
          cancel(event);
          return;
      }
    },
  };
  const formulaBar: EditorProps = {
    ...common,
    'aria-label': 'Formula bar',
    value: state.editing ? edit.draft : String(activeCell.input ?? ''),
    disabled:
      !store.source.isEditable(state.active) ||
      state.pending ||
      (!state.editing && (activeCell.status === 'loading' || activeCell.status === 'calculating')),
    onFocus(event) {
      formula.track(event);
      store.beginEdit(store.getSnapshot().active, undefined, 'bar');
    },
    onChange(event) {
      store.setDraft(event.target.value);
      formula.track(event);
    },
    onKeyDown(event) {
      if (event.nativeEvent.isComposing || formula.onKeyDown(event)) return;
      if (handleCaretKeys(event)) {
        formula.track(event);
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        void edit.commit();
      } else if (event.key === 'Escape') cancel(event);
    },
  };
  return { editor, formulaBar };
}
