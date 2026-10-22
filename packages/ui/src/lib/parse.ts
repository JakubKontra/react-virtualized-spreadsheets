export interface IntRange {
  readonly min: number;
  readonly max: number;
}

/** Parses a whole number typed into an input; `null` when empty, fractional or out of range. */
export function parseIntInput(raw: string, { min, max }: IntRange): number | null {
  const text = raw.trim();
  if (!/^-?\d+$/.test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : null;
}
