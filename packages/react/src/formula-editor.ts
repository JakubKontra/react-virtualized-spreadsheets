import { useRef, useState, type KeyboardEvent, type SyntheticEvent } from 'react';
import { parseAddress, type Address, type CellRange, type SpreadsheetStore } from '@sheet/core';
const functions = [
  { name: 'SUM', signature: 'SUM(number1, number2, …)', description: 'Add numbers and ranges' },
  {
    name: 'AVERAGE',
    signature: 'AVERAGE(number1, number2, …)',
    description: 'Mean of numeric values',
  },
  { name: 'MIN', signature: 'MIN(number1, number2, …)', description: 'Smallest numeric value' },
  { name: 'MAX', signature: 'MAX(number1, number2, …)', description: 'Largest numeric value' },
  { name: 'COUNT', signature: 'COUNT(value1, value2, …)', description: 'Count numeric values' },
  {
    name: 'IF',
    signature: 'IF(condition, value_if_true, value_if_false)',
    description: 'Choose a value based on a condition',
  },
];
const colors = ['#2563eb', '#a855f7', '#d97706', '#08916d'];
const unquoted = (text: string) => {
  let quoted = false,
    result = '';
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') {
      if (quoted && text[i + 1] === '"') {
        result += '  ';
        i++;
        continue;
      }
      quoted = !quoted;
      result += ' ';
    } else result += quoted ? ' ' : text[i];
  }
  return result;
};
export function useFormulaEditor(store: SpreadsheetStore, draft: string, editing: Address | null) {
  const input = useRef<HTMLInputElement | null>(null);
  const cursor = useRef({ start: draft.length, end: draft.length });
  const [caret, setCaret] = useState(draft.length),
    [highlight, setHighlight] = useState(0),
    [dismissed, setDismissed] = useState('');
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
    for (const match of text.matchAll(/([A-Z]+)\(|([(),])/gi)) {
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
  }
  function restore(position: number) {
    cursor.current = { start: position, end: position };
    setCaret(position);
    requestAnimationFrame(() => {
      input.current?.focus({ preventScroll: true });
      input.current?.setSelectionRange(position, position);
    });
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
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
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
