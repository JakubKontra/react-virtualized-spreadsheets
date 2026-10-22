import { LIMITS } from '../limits';

export type TokenKind = 'number' | 'string' | 'ref' | 'name' | 'op' | 'error';
export interface Token {
  readonly text: string;
  readonly kind: TokenKind;
  readonly start: number;
  readonly end: number;
}

function kindOf(text: string): TokenKind {
  if (text.startsWith('"')) return 'string';
  if (text === '#REF!') return 'error';
  if (/^\$?[A-Za-z]+\$?\d+$/.test(text)) return 'ref';
  if (/^[\d.]/.test(text)) return 'number';
  if (/^[A-Za-z_]/.test(text)) return 'name';
  return 'op';
}

/** Splits a formula body (without the leading `=`) into tokens with source offsets. */
export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  const re =
    /\s+|"(?:[^"]|"")*"|#REF!|\$?[A-Za-z]+\$?[1-9]\d*|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z_][A-Za-z_0-9]*|<>|<=|>=|[+\-*/^&%=<>(),:]/gy;
  let index = 0;
  while (index < source.length) {
    re.lastIndex = index;
    const text = re.exec(source)?.[0];
    if (text === undefined) throw new Error(`Unexpected character at ${index + 1}`);
    const start = index;
    index = re.lastIndex;
    if (/^\s/.test(text)) continue;
    tokens.push({ text, kind: kindOf(text), start, end: index });
    if (tokens.length > LIMITS.maxFormulaTokens) throw new Error('Formula is too long');
  }
  return tokens;
}
