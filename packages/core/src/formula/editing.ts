import { isError } from '../cell';
import type { Expression } from './ast';
import { argumentError, FORMULA_FUNCTIONS } from './functions';
import { parseFormula } from './parse';

/** Preserve offsets while hiding quoted text, including doubled quotes. */
export function maskFormulaStrings(source: string): { text: string; quoted: boolean } {
  let quoted = false;
  let text = '';
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
  readonly severity: 'incomplete' | 'error';
  readonly message: string;
}
export interface FormulaPreviewPart {
  readonly text: string;
  readonly paired: boolean;
}
export type BracketPair = readonly [open: number, close: number];
export interface FormulaEditingAnalysis {
  readonly diagnostics: readonly FormulaDiagnostic[];
  readonly bracketPair: BracketPair | null;
  readonly preview: readonly FormulaPreviewPart[];
  readonly canToggleReference: boolean;
}
export interface TextSelection {
  readonly value: string;
  readonly start: number;
  readonly end: number;
}

interface ReferenceToken {
  readonly start: number;
  readonly end: number;
  readonly label: string;
}
function referenceTokens(text: string): ReferenceToken[] {
  return Array.from(text.matchAll(/(?<![\w.])\$?[A-Z]+\$?[1-9]\d*(?!\w)/gi), (m) => ({
    start: m.index,
    end: m.index + m[0].length,
    label: m[0],
  }));
}
function selectedReferences(text: string, start: number, end: number) {
  const tokens = referenceTokens(text);
  return start === end
    ? tokens.filter((r) => r.start <= start && r.end >= start).slice(0, 1)
    : tokens.filter((r) => r.start < end && r.end > start);
}

const REFERENCE_PARTS = /^(?<fixCol>\$?)(?<col>[A-Z]+)(?<fixRow>\$?)(?<row>\d+)$/i;

/** Cycles A1 → $A$1 → A$1 → $A1 → A1 for the references at the selection. */
export function toggleFormulaReference(
  draft: string,
  start: number,
  end = start,
): TextSelection | null {
  if (!draft.startsWith('=')) return null;
  const refs = selectedReferences(maskFormulaStrings(draft).text, start, end);
  if (!refs.length) return null;
  const changes = refs.map((ref) => {
    const parts = REFERENCE_PARTS.exec(ref.label)?.groups ?? {};
    const fixedCol = !!parts['fixCol'];
    const fixedRow = !!parts['fixRow'];
    // Cycle: relative -> both fixed -> row fixed -> column fixed -> relative.
    const [nextCol, nextRow] =
      !fixedCol && !fixedRow
        ? [true, true]
        : fixedCol && fixedRow
          ? [false, true]
          : fixedRow
            ? [true, false]
            : [false, false];
    return {
      ...ref,
      replacement: `${nextCol ? '$' : ''}${parts['col'] ?? ''}${nextRow ? '$' : ''}${parts['row'] ?? ''}`,
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

export function analyzeFormulaEditing(
  draft: string,
  caret: number,
  end = caret,
): FormulaEditingAnalysis {
  const diagnostics: FormulaDiagnostic[] = [];
  if (!draft.startsWith('='))
    return { diagnostics, bracketPair: null, canToggleReference: false, preview: [] };
  const { text, quoted } = maskFormulaStrings(draft);
  const opens: number[] = [];
  const pairs: BracketPair[] = [];
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
  const bracketPair = pairs.find((pair) => pair.includes(adjacent)) ?? null;
  const expr = parseFormula(draft);
  const unknown = Array.from(text.matchAll(/\b([A-Z][A-Z_0-9]*)\s*\(/gi), (call) =>
    (call[1] ?? '').toUpperCase(),
  ).find((name) => !FORMULA_FUNCTIONS.some((fn) => fn.name === name));
  if (unknown !== undefined)
    diagnostics.push({ severity: 'error', message: `Unknown function ${unknown}` });
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
      switch (node.type) {
        case 'call': {
          const error = argumentError(node.name, node.args.length);
          if (error) diagnostics.push({ severity: 'error', message: error.message });
          node.args.forEach(visit);
          break;
        }
        case 'binary':
          visit(node.left);
          visit(node.right);
          break;
        case 'unary':
          visit(node.value);
          break;
        case 'union':
          node.items.forEach(visit);
          break;
        case 'literal':
        case 'ref':
        case 'range':
          break;
      }
    };
    visit(expr);
  }
  const preview: FormulaPreviewPart[] = [];
  if (bracketPair) {
    let from = 0;
    for (const index of bracketPair) {
      if (from < index) preview.push({ text: draft.slice(from, index), paired: false });
      preview.push({ text: draft.slice(index, index + 1), paired: true });
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
