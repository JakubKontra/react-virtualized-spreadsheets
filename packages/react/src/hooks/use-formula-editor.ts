import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  analyzeFormulaEditing,
  FORMULA_FUNCTIONS,
  toggleFormulaReference,
  type Address,
  type CellRange,
  type SpreadsheetStore,
  type TextSelection,
} from '@sheet/core';
import {
  callAt,
  completionToken,
  formulaReferences,
  functionsStartingWith,
  referenceContains,
  unquoted,
} from '../internal/formula-references';
import type { FormulaEditorController, ReferencePick } from '../types';

const SUGGESTION_KEYS = ['ArrowDown', 'ArrowUp', 'Tab', 'Enter', 'Escape'];
/** Point mode starts where an operand is expected. */
const OPERAND_EXPECTED = /[=(,+\-*/^<>:]\s*$/;

export function useFormulaEditor(
  store: SpreadsheetStore,
  draft: string,
  editing: Address | null,
): FormulaEditorController {
  const input = useRef<HTMLInputElement | null>(null);
  const pendingSelection = useRef<TextSelection | null>(null);
  const cursor = useRef({ start: draft.length, end: draft.length });
  const [caret, setCaret] = useState(draft.length);
  const [selectionEnd, setSelectionEnd] = useState(draft.length);
  const [highlight, setHighlight] = useState(0);
  const [dismissed, setDismissed] = useState('');
  useLayoutEffect(() => {
    const pending = pendingSelection.current;
    pendingSelection.current = null;
    // Restore after React writes this draft, before the next input can change the selection.
    if (!pending || !editing || input.current?.value !== pending.value) return;
    input.current.focus({ preventScroll: true });
    input.current.setSelectionRange(pending.start, pending.end);
  });
  const isEditing = editing !== null;
  const analysis = useMemo(
    () => analyzeFormulaEditing(isEditing ? draft : '', caret, selectionEnd),
    [draft, isEditing, caret, selectionEnd],
  );
  const isFormulaDraft = isEditing && draft.startsWith('=');
  const text = unquoted(draft.slice(0, caret));
  const token = isFormulaDraft ? completionToken(text) : null;
  const suggestions = token !== null && dismissed !== draft ? functionsStartingWith(token) : [];
  const selected = Math.min(highlight, Math.max(0, suggestions.length - 1));
  const references = isFormulaDraft ? formulaReferences(draft) : [];
  const call = isFormulaDraft ? callAt(text) : undefined;
  const help = call && FORMULA_FUNCTIONS.find((f) => f.name === call.name);
  function track(event: { readonly currentTarget: HTMLInputElement }) {
    const element = event.currentTarget;
    input.current = element;
    cursor.current = {
      start: element.selectionStart ?? element.value.length,
      end: element.selectionEnd ?? element.value.length,
    };
    setCaret(cursor.current.start);
    setSelectionEnd(cursor.current.end);
  }
  function restore(position: number, end = position) {
    cursor.current = { start: position, end };
    setCaret(position);
    setSelectionEnd(end);
    pendingSelection.current = { value: store.getSnapshot().draft ?? '', start: position, end };
  }
  function accept(index = selected) {
    const suggestion = suggestions[index];
    if (token === null || !suggestion) return;
    const before = caret - token.length;
    store.setDraft(
      `${draft.slice(0, before)}${suggestion.name}(${draft.slice(cursor.current.end)}`,
    );
    setHighlight(0);
    restore(before + suggestion.name.length + 1);
  }
  function toggleAbsoluteReference() {
    const next = toggleFormulaReference(
      store.getSnapshot().draft ?? '',
      cursor.current.start,
      cursor.current.end,
    );
    if (!next) return;
    store.setDraft(next.value);
    restore(next.start, next.end);
  }
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): boolean {
    if (
      event.key === 'F4' &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey &&
      draft.startsWith('=')
    ) {
      event.preventDefault();
      event.stopPropagation();
      toggleAbsoluteReference();
      return true;
    }
    if (!suggestions.length || !SUGGESTION_KEYS.includes(event.key)) return false;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') setDismissed(draft);
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp')
      setHighlight(
        (selected + (event.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length,
      );
    else accept();
    return true;
  }
  function pick(): ReferencePick | null {
    const value = store.getSnapshot().draft;
    if (!value?.startsWith('=')) return null;
    const { start, end } = cursor.current;
    // Point mode starts where an operand is expected, or replaces an explicitly selected token.
    if (start === end && !OPERAND_EXPECTED.test(unquoted(value.slice(0, start)))) return null;
    return {
      update(range: CellRange) {
        const a = store.labelAddress(range.start);
        const b = store.labelAddress(range.end);
        const label = a === b ? a : `${a}:${b}`;
        store.setDraft(value.slice(0, start) + label + value.slice(end));
        restore(start + label.length);
      },
      cancel() {
        store.setDraft(value);
        restore(start);
      },
    };
  }
  const referenceColor = (address: Address) => {
    if (!references.length) return undefined;
    const logical = store.logicalAddress(address);
    return references.find((reference) => referenceContains(reference, logical))?.color;
  };
  return {
    ...analysis,
    toggleAbsoluteReference,
    track,
    onKeyDown,
    accept,
    pick,
    suggestions,
    selected,
    references,
    referenceColor,
    help: help && call ? { ...help, argument: call.argument + 1 } : null,
  };
}
