import { parseFormula, type Expression } from './formula';
import { argumentError, FORMULA_FUNCTIONS } from './formula-functions';
import { isError } from './types';

/** Preserve offsets while hiding quoted text, including doubled quotes. */
export function maskFormulaStrings(source: string) {
  let quoted = false,
    text = '';
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '"') {
      if (quoted && source[i + 1] === '"') {
        text += '  ';
        i++;
        continue;
      }
      quoted = !quoted;
      text += ' ';
    } else text += quoted ? ' ' : source[i];
  }
  return { text, quoted };
}
export interface FormulaDiagnostic {
  severity: 'incomplete' | 'error';
  message: string;
}
function referenceTokens(text: string) {
  return Array.from(text.matchAll(/(?<![\w.])\$?[A-Z]+\$?[1-9]\d*(?!\w)/gi), (m) => ({
    start: m.index!,
    end: m.index! + m[0].length,
    label: m[0],
  }));
}
function selectedReferences(text: string, start: number, end: number) {
  const tokens = referenceTokens(text);
  return start === end
    ? tokens.filter((r) => r.start <= start && r.end >= start).slice(0, 1)
    : tokens.filter((r) => r.start < end && r.end > start);
}
export function toggleFormulaReference(draft: string, start: number, end = start) {
  if (!draft.startsWith('=')) return null;
  const refs = selectedReferences(maskFormulaStrings(draft).text, start, end);
  if (!refs.length) return null;
  const changes = refs.map((ref) => {
    const match = /^(\$?)([A-Z]+)(\$?)(\d+)$/i.exec(ref.label)!;
    // Cycle: relative -> both fixed -> row fixed -> column fixed -> relative.
    const key = `${match[1] ? 1 : 0}${match[3] ? 1 : 0}` as '00' | '11' | '01' | '10';
    const next = (
      {
        '00': [true, true],
        '11': [false, true],
        '01': [true, false],
        '10': [false, false],
      } as const
    )[key];
    return {
      ...ref,
      replacement: `${next[0] ? '$' : ''}${match[2]}${next[1] ? '$' : ''}${match[4]}`,
    };
  });
  const mapPosition = (position: number) => {
    let delta = 0;
    for (const change of changes) {
      if (position <= change.start) break;
      if (position < change.end)
        return (
          change.start + delta + Math.max(0, change.replacement.length - (change.end - position))
        );
      delta += change.replacement.length - change.label.length;
    }
    return position + delta;
  };
  let value = draft;
  for (const change of [...changes].reverse())
    value = value.slice(0, change.start) + change.replacement + value.slice(change.end);
  return { value, start: mapPosition(start), end: mapPosition(end) };
}
export function analyzeFormulaEditing(draft: string, caret: number, end = caret) {
  const diagnostics: FormulaDiagnostic[] = [];
  let bracketPair: [number, number] | null = null;
  if (!draft.startsWith('='))
    return { diagnostics, bracketPair, canToggleReference: false, preview: [] };
  const { text, quoted } = maskFormulaStrings(draft);
  const opens: number[] = [],
    pairs: [number, number][] = [];
  let unmatchedClose = false;
  for (let i = 1; i < text.length; i++) {
    if (text[i] === '(') opens.push(i);
    else if (text[i] === ')') {
      const open = opens.pop();
      if (open === undefined) unmatchedClose = true;
      else pairs.push([open, i]);
    }
  }
  const adjacent = '()'.includes(text[caret] ?? ' ') ? caret : caret - 1;
  bracketPair = pairs.find((pair) => pair.includes(adjacent)) ?? null;
  const expr = parseFormula(draft);
  const calls = Array.from(text.matchAll(/\b([A-Z][A-Z_0-9]*)\s*\(/gi));
  const unknown = calls.find(
    (call) => !FORMULA_FUNCTIONS.some((fn) => fn.name === call[1].toUpperCase()),
  );
  if (unknown)
    diagnostics.push({
      severity: 'error',
      message: `Unknown function ${unknown[1].toUpperCase()}`,
    });
  else if (expr.type === 'literal' && isError(expr.value) && expr.value.error === '#ERROR!') {
    const pendingName =
      /^=\s*[A-Z]+$/i.test(draft) &&
      FORMULA_FUNCTIONS.some((fn) => fn.name.startsWith(draft.slice(1).trim().toUpperCase()));
    const incomplete =
      !unmatchedClose &&
      (quoted ||
        pendingName ||
        (['Incomplete formula', 'Expected )'].includes(expr.value.message) &&
          (opens.length > 0 || /[=,+\-*/^&<>]\s*$/.test(text))));
    diagnostics.push({
      severity: incomplete ? 'incomplete' : 'error',
      message: incomplete ? 'Continue typing to complete the formula.' : expr.value.message,
    });
  } else {
    const visit = (node: Expression) => {
      if (node.type === 'call') {
        const error = argumentError(node.name, node.args.length);
        if (error) diagnostics.push({ severity: 'error', message: error.message });
        node.args.forEach(visit);
      } else if (node.type === 'binary') {
        visit(node.left);
        visit(node.right);
      } else if (node.type === 'unary') visit(node.value);
      else if (node.type === 'union') node.items.forEach(visit);
    };
    visit(expr);
  }
  const preview: { text: string; paired: boolean }[] = [];
  if (bracketPair) {
    let from = 0;
    for (const index of bracketPair) {
      if (from < index) preview.push({ text: draft.slice(from, index), paired: false });
      preview.push({ text: draft[index], paired: true });
      from = index + 1;
    }
    if (from < draft.length) preview.push({ text: draft.slice(from), paired: false });
  }
  return {
    diagnostics,
    bracketPair,
    preview,
    canToggleReference: selectedReferences(text, caret, end).length > 0,
  };
}
