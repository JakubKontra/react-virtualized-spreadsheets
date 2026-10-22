import {
  ViewCalculationRegistry,
  type CellRange,
  type DataBlock,
  type EngineSession,
  type Mutation,
  type MutationResult,
  type Revision,
  type SelectionSummary,
  type SheetViewState,
  type ViewBlocks,
  type ViewRows,
} from '@sheet/core';
import type { Handlers } from './core';

/** Requests a calculation worker answers. A type alias, so it satisfies `ProtocolShape`. */
export type CalculationProtocol = {
  readonly block: { readonly params: CellRange; readonly result: DataBlock };
  readonly viewBlocks: {
    readonly params: {
      readonly view: SheetViewState;
      readonly ranges: readonly CellRange<'canonical'>[];
    };
    readonly result: ViewBlocks;
  };
  readonly viewQuery: {
    readonly params: { readonly view: SheetViewState };
    readonly result: ViewRows;
  };
  readonly viewSummary: {
    readonly params: { readonly view: SheetViewState; readonly range: CellRange };
    readonly result: SelectionSummary;
  };
  readonly mutate: {
    readonly params: { readonly mutation: Mutation; readonly revision: Revision };
    readonly result: MutationResult;
  };
};

/** Handlers for a session and its view overlays. Extend or override them for custom workers. */
export function createCalculationHandlers(
  session: EngineSession,
  views: ViewCalculationRegistry = new ViewCalculationRegistry(session.engine),
): Handlers<CalculationProtocol> {
  return {
    block: (range) => session.block(range),
    viewBlocks: ({ view, ranges }) => views.blocks(view, ranges, session.revision),
    viewQuery: ({ view }) => views.query(view, session.revision),
    viewSummary: ({ view, range }) => views.summary(view, range, session.revision),
    mutate: ({ mutation, revision }) => session.mutate(mutation, revision),
  };
}
