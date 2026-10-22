import type { CellValue } from '../cell';
import type { Address, IndexSpace } from '../coords';

export const BINARY_OPERATORS = [
  '=',
  '<>',
  '<',
  '>',
  '<=',
  '>=',
  '&',
  '+',
  '-',
  '*',
  '/',
  '^',
] as const;
export type BinaryOperator = (typeof BINARY_OPERATORS)[number];
export type ComparisonOperator = Extract<BinaryOperator, '=' | '<>' | '<' | '>' | '<=' | '>='>;
export type ArithmeticOperator = Extract<BinaryOperator, '+' | '-' | '*' | '/' | '^'>;
export type UnaryOperator = '+' | '-';

export const isBinaryOperator = (text: string): text is BinaryOperator =>
  BINARY_OPERATORS.some((op) => op === text);
export const isComparison = (op: BinaryOperator): op is ComparisonOperator =>
  op === '=' || op === '<>' || op === '<' || op === '>' || op === '<=' || op === '>=';

/** Binding strength of each binary operator. */
export const PRECEDENCE: Readonly<Record<BinaryOperator, number>> = {
  '=': 1,
  '<>': 1,
  '<': 1,
  '>': 1,
  '<=': 1,
  '>=': 1,
  '&': 2,
  '+': 3,
  '-': 3,
  '*': 4,
  '/': 4,
  '^': 5,
};

/** A1 reference. The address is in the coordinate space the formula was written in. */
export interface RefNode<S extends IndexSpace = 'visible'> {
  readonly type: 'ref';
  readonly address: Address<S>;
  readonly fixedRow: boolean;
  readonly fixedCol: boolean;
}
export type Expression<S extends IndexSpace = 'visible'> =
  | { readonly type: 'literal'; readonly value: CellValue }
  | RefNode<S>
  | { readonly type: 'range'; readonly start: RefNode<S>; readonly end: RefNode<S> }
  | { readonly type: 'union'; readonly items: readonly Expression<S>[] }
  | { readonly type: 'unary'; readonly op: UnaryOperator; readonly value: Expression<S> }
  | {
      readonly type: 'binary';
      readonly op: BinaryOperator;
      readonly left: Expression<S>;
      readonly right: Expression<S>;
    }
  | { readonly type: 'call'; readonly name: string; readonly args: readonly Expression<S>[] };

export type ExpressionOf<T extends Expression<IndexSpace>['type'], S extends IndexSpace> = Extract<
  Expression<S>,
  { type: T }
>;
