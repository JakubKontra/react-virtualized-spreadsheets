/** Compile-time exhaustiveness check for discriminated unions. */
export function assertNever(value: never, message = 'Unexpected value'): never {
  throw new Error(`${message}: ${JSON.stringify(value)}`);
}

/** Internal invariant; failing it is a bug in `@sheet/*`, not a user error. */
export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invariant failed: ${message}`);
}

/** Oldest key of an insertion-ordered map, for LRU eviction. */
export function firstKey<K>(map: ReadonlyMap<K, unknown>): K | undefined {
  for (const key of map.keys()) return key;
  return undefined;
}

export const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** `Object.keys` typed to the object's own declared keys. */
export const keysOf = <T extends object>(value: T): (keyof T)[] =>
  // Object.keys widens to string[]; callers only pass plain objects of known shape.
  Object.keys(value) as (keyof T)[];
