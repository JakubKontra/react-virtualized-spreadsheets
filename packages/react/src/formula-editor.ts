import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type SyntheticEvent,
} from 'react';
import {
  FORMULA_FUNCTIONS as functions,
  maskFormulaStrings,
  analyzeFormulaEditing,
  toggleFormulaReference,
  parseAddress,
  type Address,
  type CellRange,
  type SpreadsheetStore,
} from '@sheet/core';
const colors = ['#2563eb', '#a855f7', '#d97706', '#08916d'];
const unquoted = (text: string) => maskFormulaStrings(text).text;
export function useFormulaEditor(store: SpreadsheetStore, draft: string, editing: Address | null) {
  const input = useRef<HTMLInputElement | null>(null);
  const pendingSelection = useRef<{ value: string; start: number; end: number } | null>(null);
  const cursor = useRef({ start: draft.length, end: draft.length });
  const [caret, setCaret] = useState(draft.length),
    [selectionEnd, setSelectionEnd] = useState(draft.length),
    [highlight, setHighlight] = useState(0),
    [dismissed, setDismissed] = useState('');
  useLayoutEffect(() => {
    const pending = pendingSelection.current;
    pendingSelection.current = null;
    // Restore after React writes this draft, before the next input can change the selection.
    if (!pending || !editing || input.current?.value !== pending.value) return;
    input.current.focus({ preventScroll: true });
    input.current.setSelectionRange(pending.start, pending.end);
  });
  const analysis = useMemo(
    () => analyzeFormulaEditing(editing ? draft : '', caret, selectionEnd),
    [draft, !!editing, caret, selectionEnd],
  );
  const text = unquoted(draft.slice(0, caret));
  const token = editing && draft.startsWith('=') ? /([A-Z]+)$/i.exec(text) : null;
  const suggestions =
    token && dismissed !== draft
      ? functions.filter((f) => f.name.startsWith(token[1].toUpperCase()))
      : [];
  const selected = Math.min(highlight, Math.max(0, suggestions.length - 1));
  const references =
    editing && draft.startsWith('=')
      ? Array.from(
          unquoted(draft).matchAll(/\$?[A-Z]+\$?[1-9]\d*(?::\$?[A-Z]+\$?[1-9]\d*)?/gi),
        ).map((m, i) => {
          const [a, b] = m[0].split(':');
          return {
            label: m[0],
            start: parseAddress(a)!,
            end: parseAddress(b ?? a)!,
            color: colors[i % colors.length],
          };
        })
      : [];
  const stack: { name: string; argument: number }[] = [];
  if (editing && draft.startsWith('='))
    for (const match of text.matchAll(/([A-Z]+)\s*\(|([(),])/gi)) {
      if (match[1]) stack.push({ name: match[1].toUpperCase(), argument: 0 });
      else if (match[2] === '(') stack.push({ name: '', argument: 0 });
      else if (match[2] === ')') stack.pop();
      else if (stack.length) stack[stack.length - 1].argument++;
    }
  const call = stack.at(-1),
    help = functions.find((f) => f.name === call?.name);
  function track(event: SyntheticEvent<HTMLInputElement>) {
    input.current = event.currentTarget;
    cursor.current = {
      start: event.currentTarget.selectionStart ?? event.currentTarget.value.length,
      end: event.currentTarget.selectionEnd ?? event.currentTarget.value.length,
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
    if (!token || !suggestions[index]) return;
    const next =
      draft.slice(0, caret - token[1].length) +
      suggestions[index].name +
      '(' +
      draft.slice(cursor.current.end);
    store.setDraft(next);
    setHighlight(0);
    restore(caret - token[1].length + suggestions[index].name.length + 1);
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
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
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
    if (!suggestions.length) return false;
    if (['ArrowDown', 'ArrowUp', 'Tab', 'Enter', 'Escape'].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') setDismissed(draft);
      else if (event.key === 'ArrowDown' || event.key === 'ArrowUp')
        setHighlight(
          (selected + (event.key === 'ArrowDown' ? 1 : -1) + suggestions.length) %
            suggestions.length,
        );
      else accept();
      return true;
    }
    return false;
  }
  function pick() {
    const value = store.getSnapshot().draft;
    if (!value?.startsWith('=')) return null;
    const { start, end } = cursor.current;
    // Point mode starts where an operand is expected, or replaces an explicitly selected token.
    if (start === end && !/[=(,+\-*/^<>:]\s*$/.test(unquoted(value.slice(0, start)))) return null;
    return {
      update(range: CellRange) {
        const a = store.labelAddress(range.start),
          b = store.labelAddress(range.end),
          label = a === b ? a : `${a}:${b}`;
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
    const logical = store.logicalAddress(address);
    return references.find(
      (r) =>
        logical.row >= Math.min(r.start.row, r.end.row) &&
        logical.row <= Math.max(r.start.row, r.end.row) &&
        logical.col >= Math.min(r.start.col, r.end.col) &&
        logical.col <= Math.max(r.start.col, r.end.col),
    )?.color;
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
    help: help ? { ...help, argument: call!.argument + 1 } : null,
  };
}
