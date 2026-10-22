/** Hard limits shared by the engine, the store, the transports and the demo server. */
export const LIMITS = {
  /** Cells per mutation, paste, fill or clear. */
  maxEditCells: 10_000,
  /** Cells per calculated block or view request. */
  maxBlockCells: 20_000,
  /** Ranges per view-block request. */
  maxViewRanges: 1_024,
  /** Items resized by one view change. */
  maxResizeItems: 10_000,
  /** Default undo depth. */
  historyLimit: 100,
  /** Default number of computed formula values kept by the engine. */
  maxCachedFormulas: 10_000,
  /** Parsed formula ASTs kept by the engine. */
  maxParsedFormulas: 2_048,
  /** Tokens per formula. */
  maxFormulaTokens: 2_048,
  /** Characters per column formula accepted by the demo server. */
  maxFormulaLength: 8_192,
  /** Expression nesting depth. */
  maxFormulaNesting: 128,
  /** Dependency chain depth before `#NUM!`. */
  maxDependencyDepth: 256,
  maxSorts: 3,
  maxFilters: 8,
  maxSearchLength: 200,
  maxViewNameLength: 100,
  maxSelectOptions: 100,
  maxSelectOptionLength: 200,
  maxFrozenRows: 20,
  maxFrozenColumns: 10,
  /** Bytes per persisted view document. */
  maxViewBytes: 2_000_000,
} as const;
