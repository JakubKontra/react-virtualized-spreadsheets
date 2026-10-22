import { describe, expect, expectTypeOf, it } from 'vitest';
import { parse, SheetError, ValidationError } from '../packages/core/src';

const { array, finite, int, literal, nullable, object, optional, str, variant } = parse;

const order = object({
  id: str({ min: 1 }),
  status: literal('open', 'closed'),
  lines: array(object({ sku: str(), quantity: int({ min: 1 }) })),
  discount: nullable(finite),
  note: optional(str()),
});

/** The thrown error of `run`, which must be a `ValidationError`. */
function failure(run: () => unknown): ValidationError {
  try {
    run();
  } catch (error) {
    if (error instanceof ValidationError) return error;
    throw error;
  }
  throw new Error('Expected a validation failure');
}

describe('validation parsers', () => {
  it('parses a valid nested document and drops unknown fields', () => {
    const input = {
      id: 'A-1',
      status: 'open',
      lines: [{ sku: 'x', quantity: 2, extra: true }],
      discount: null,
      note: 'rush',
      unknown: 1,
    };
    const result = order(input);
    expect(result).toEqual({
      id: 'A-1',
      status: 'open',
      lines: [{ sku: 'x', quantity: 2 }],
      discount: null,
      note: 'rush',
    });
    expectTypeOf(result.status).toEqualTypeOf<'open' | 'closed'>();
    expectTypeOf(result.discount).toEqualTypeOf<number | null>();
  });
  it('names the offending path in the error message', () => {
    const error = failure(() =>
      order({
        id: 'A-1',
        status: 'open',
        lines: [
          { sku: 'x', quantity: 1 },
          { sku: 'y', quantity: 'two' },
        ],
        discount: null,
      }),
    );
    expect(error).toBeInstanceOf(SheetError);
    expect(error.code).toBe('INVALID_INPUT');
    expect(error.path).toBe('lines[1].quantity');
    expect(error.message).toBe('Expected an integer (lines[1].quantity)');
    expect(() => order({ id: 'A-1', status: 'pending', lines: [], discount: null })).toThrow(
      'Expected one of "open", "closed" (status)',
    );
    expect(() => int({ min: 1 })(0)).toThrow(/^Expected at least 1$/);
  });
  it('omits absent and undefined optional fields', () => {
    const base = { id: 'A-1', status: 'closed', lines: [], discount: 0.1 };
    const absent = order(base);
    expect('note' in absent).toBe(false);
    expect('note' in order({ ...base, note: undefined })).toBe(false);
    expect(order({ ...base, note: 'n' }).note).toBe('n');
    expectTypeOf(absent).toEqualTypeOf<{
      id: string;
      status: 'open' | 'closed';
      lines: { sku: string; quantity: number }[];
      discount: number | null;
      note?: string;
    }>();
    expect(() => order({ ...base, note: null })).toThrow('Expected a string (note)');
  });
  it('selects a discriminated variant by its tag', () => {
    const shape = variant('kind', {
      circle: object({ kind: literal('circle'), radius: finite }),
      square: object({ kind: literal('square'), side: finite }),
    });
    const parsed = shape({ kind: 'square', side: 2, radius: 9 });
    expect(parsed).toEqual({ kind: 'square', side: 2 });
    expectTypeOf(parsed).toEqualTypeOf<
      { kind: 'circle'; radius: number } | { kind: 'square'; side: number }
    >();
    if (parsed.kind === 'square') expectTypeOf(parsed.side).toEqualTypeOf<number>();
    expect(failure(() => shape({ kind: 'triangle' })).path).toBe('kind');
    // Inherited keys are not variants.
    expect(() => shape({ kind: 'toString' })).toThrow('Unknown variant (kind)');
    const nested = object({ shapes: array(shape) });
    expect(() => nested({ shapes: [{ kind: 'circle', radius: 'big' }] })).toThrow(
      'Expected a number (shapes[0].radius)',
    );
    expect(() => nested({ shapes: [{ side: 1 }] })).toThrow('Unknown variant (shapes[0].kind)');
  });
  it('parses JSON text and replaces messages on request', () => {
    expect(parse.parseJson('{"id":"x"}', object({ id: str() }))).toEqual({ id: 'x' });
    expect(() => parse.parseJson('{', object({ id: str() }))).toThrow('Invalid JSON');
    const friendly = parse.withMessage(object({ id: str() }), 'Invalid order');
    expect(() => friendly({ id: 1 })).toThrow(/^Invalid order$/);
  });
});
