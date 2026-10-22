import { isRecord } from './assert';
import { SheetError } from './errors';

/**
 * Minimal runtime parsers for untrusted data (JSON from storage, HTTP and workers).
 * A parser returns a typed value or throws `ValidationError` naming the offending path.
 * Parsers are annotated against the hand-written public interfaces, so the compiler checks
 * that validation and documentation agree.
 */
export class ValidationError extends SheetError {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super('INVALID_INPUT', path ? `${message} (${path})` : message);
  }
}

export type Parser<T> = (input: unknown, path?: string) => T;
export type Infer<P> = P extends Parser<infer T> ? T : never;

/** Marks an object field that may be absent. Absent and `undefined` values are omitted. */
export interface OptionalParser<T> extends Parser<T | undefined> {
  readonly optional: true;
}

const fail = (path: string, message: string): never => {
  throw new ValidationError(path, message);
};

export function str(
  options: { min?: number; max?: number; pattern?: RegExp } = {},
): Parser<string> {
  return (input, path = '') => {
    if (typeof input !== 'string') return fail(path, 'Expected a string');
    if (options.min !== undefined && input.length < options.min)
      return fail(path, `Expected at least ${options.min} characters`);
    if (options.max !== undefined && input.length > options.max)
      return fail(path, `Expected at most ${options.max} characters`);
    if (options.pattern && !options.pattern.test(input)) return fail(path, 'Invalid format');
    return input;
  };
}

export function int(options: { min?: number; max?: number } = {}): Parser<number> {
  return (input, path = '') => {
    if (typeof input !== 'number' || !Number.isSafeInteger(input))
      return fail(path, 'Expected an integer');
    if (options.min !== undefined && input < options.min)
      return fail(path, `Expected at least ${options.min}`);
    if (options.max !== undefined && input > options.max)
      return fail(path, `Expected at most ${options.max}`);
    return input;
  };
}

export const finite: Parser<number> = (input, path = '') =>
  typeof input === 'number' && Number.isFinite(input) ? input : fail(path, 'Expected a number');

export const bool: Parser<boolean> = (input, path = '') =>
  typeof input === 'boolean' ? input : fail(path, 'Expected a boolean');

export const unknownValue: Parser<unknown> = (input) => input;

export function literal<const L extends readonly (string | number | boolean | null)[]>(
  ...values: L
): Parser<L[number]> {
  return (input, path = '') => {
    for (const value of values) if (value === input) return value;
    return fail(path, `Expected one of ${values.map((v) => JSON.stringify(v)).join(', ')}`);
  };
}

export function array<T>(item: Parser<T>, options: { max?: number } = {}): Parser<T[]> {
  return (input, path = '') => {
    if (!Array.isArray(input)) return fail(path, 'Expected an array');
    if (options.max !== undefined && input.length > options.max)
      return fail(path, `Expected at most ${options.max} items`);
    const result: T[] = [];
    for (let i = 0; i < input.length; i++) result.push(item(input[i], `${path}[${i}]`));
    return result;
  };
}

/** A fixed-length tuple. */
export function tuple<const P extends readonly Parser<unknown>[]>(
  ...items: P
): Parser<{ -readonly [K in keyof P]: Infer<P[K]> }> {
  return (input, path = '') => {
    if (!Array.isArray(input) || input.length !== items.length)
      return fail(path, `Expected ${items.length} items`);
    // A mapped tuple cannot be built incrementally without widening; the shape is checked above.
    return items.map((item, i) => item(input[i], `${path}[${i}]`)) as {
      -readonly [K in keyof P]: Infer<P[K]>;
    };
  };
}

/** A record whose keys match `key` (for example numeric strings) and whose values match `value`. */
export function record<V>(
  value: Parser<V>,
  options: { key?: RegExp; max?: number } = {},
): Parser<Record<string, V>> {
  return (input, path = '') => {
    if (!isRecord(input)) return fail(path, 'Expected an object');
    const entries = Object.entries(input);
    if (options.max !== undefined && entries.length > options.max)
      return fail(path, `Expected at most ${options.max} entries`);
    const result: Record<string, V> = {};
    for (const [key, item] of entries) {
      if (options.key && !options.key.test(key)) fail(`${path}.${key}`, 'Invalid key');
      result[key] = value(item, `${path}.${key}`);
    }
    return result;
  };
}

export function optional<T>(parser: Parser<T>): OptionalParser<T> {
  const optionalParser = (input: unknown, path?: string) =>
    input === undefined ? undefined : parser(input, path);
  return Object.assign(optionalParser, { optional: true as const });
}

export function nullable<T>(parser: Parser<T>): Parser<T | null> {
  return (input, path) => (input === null ? null : parser(input, path));
}

type Shape = Readonly<Record<string, Parser<unknown>>>;
type OptionalKeys<S extends Shape> = {
  [K in keyof S]: S[K] extends OptionalParser<unknown> ? K : never;
}[keyof S];
type Simplify<T> = { [K in keyof T]: T[K] } & {};
export type ObjectOf<S extends Shape> = Simplify<
  { -readonly [K in Exclude<keyof S, OptionalKeys<S>>]: Infer<S[K]> } & {
    -readonly [K in OptionalKeys<S>]?: Exclude<Infer<S[K]>, undefined>;
  }
>;

/** A plain object with the given fields. Unknown fields are dropped. */
export function object<const S extends Shape>(shape: S): Parser<ObjectOf<S>> {
  const keys = Object.keys(shape);
  return (input, path = '') => {
    if (!isRecord(input)) return fail(path, 'Expected an object');
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      const parser = shape[key];
      if (!parser) continue;
      const value = parser(input[key], path ? `${path}.${key}` : key);
      if (value !== undefined) result[key] = value;
    }
    // Every declared key was produced by its own parser; optional keys were omitted when absent.
    return result as ObjectOf<S>;
  };
}

/** The first parser that succeeds wins. */
export function union<const P extends readonly Parser<unknown>[]>(
  ...parsers: P
): Parser<Infer<P[number]>> {
  return (input, path = '') => {
    let last: unknown;
    for (const parser of parsers) {
      try {
        // Each member returns its own inferred type, which is a member of the union.
        return parser(input, path) as Infer<P[number]>;
      } catch (error) {
        last = error;
      }
    }
    throw last instanceof Error ? last : new ValidationError(path, 'No union member matched');
  };
}

/** A discriminated union selected by the value of `key`. */
export function variant<
  K extends string,
  const M extends Readonly<Record<string, Parser<unknown>>>,
>(key: K, members: M): Parser<Infer<M[keyof M]>> {
  return (input, path = '') => {
    if (!isRecord(input)) return fail(path, 'Expected an object');
    const tag = input[key];
    const parser =
      typeof tag === 'string' && Object.hasOwn(members, tag) ? members[tag] : undefined;
    if (!parser) return fail(path ? `${path}.${key}` : key, 'Unknown variant');
    // The selected member's result belongs to the union of member results.
    return parser(input, path) as Infer<M[keyof M]>;
  };
}

/** Adds a semantic check; `check` returns an error message or `null`. */
export function refine<T>(parser: Parser<T>, check: (value: T) => string | null): Parser<T> {
  return (input, path = '') => {
    const value = parser(input, path);
    const message = check(value);
    return message === null ? value : fail(path, message);
  };
}

/** Transforms a parsed value, typically to attach a brand. */
export function map<T, U>(parser: Parser<T>, transform: (value: T) => U): Parser<U> {
  return (input, path) => transform(parser(input, path));
}

/** Parses a JSON string with the given parser. */
export function parseJson<T>(text: string, parser: Parser<T>): T {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return fail('', 'Invalid JSON');
  }
  return parser(value);
}

/** Replaces any validation failure of `parser` with one user-facing message. */
export function withMessage<T>(parser: Parser<T>, message: string): Parser<T> {
  return (input, path) => {
    try {
      return parser(input, path);
    } catch (error) {
      if (error instanceof ValidationError) throw new SheetError('INVALID_INPUT', message);
      throw error;
    }
  };
}
