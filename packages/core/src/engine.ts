import { firstKey } from './assert';
import { Revision } from './brand';
import {
  formulaError,
  isCellInput,
  isError,
  isFormula,
  type CellInput,
  type CellPatch,
  type CellRecord,
  type CellValue,
  type Formula,
} from './cell';
import { Address, CellRange, cellKey, parseCellKey, type CellKey, type IndexSpace } from './coords';
import { SheetError } from './errors';
import { dependencies, evaluate, parseFormula, shiftFormula, type Expression } from './formula';
import { LIMITS } from './limits';
import type { DataBlock, Mutation, MutationResult, SheetMetadata } from './source';

export interface EngineOptions<S extends IndexSpace = 'visible'> {
  readonly rows: number;
  readonly columns: number;
  readonly cells?: readonly CellPatch<S>[] | undefined;
  /** Column formulas written for the first row, keyed by column index. */
  readonly columnFormulas?: Readonly<Partial<Record<number, Formula>>> | undefined;
  /** A synchronous, complete source. It must never return null for unloaded data. */
  readonly readInput?: ((address: Address<S>) => CellInput) | undefined;
  readonly maxCachedFormulas?: number | undefined;
  readonly isPresent?: ((address: Address<S>) => boolean) | undefined;
}

export interface EngineStats {
  readonly inputs: number;
  readonly cachedFormulas: number;
  readonly parsedFormulas: number;
  readonly dependencyCells: number;
  readonly rangeDependencies: number;
  readonly evaluations: number;
}

function validateInput(input: CellInput) {
  if (typeof input === 'number' && !Number.isFinite(input))
    throw new SheetError('INVALID_INPUT', 'Cell numbers must be finite');
  if (!isCellInput(input)) throw new SheetError('INVALID_INPUT', 'Invalid cell input');
}

/**
 * Sparse inputs, lazy formula columns, and bounded computed values. No React or DOM dependencies.
 * `S` is the coordinate space of the engine's addresses; view overlays run in canonical space.
 */
export class FormulaEngine<S extends IndexSpace = 'visible'> {
  readonly rows: number;
  readonly columns: number;
  private inputs = new Map<CellKey, CellInput>();
  private columnsWithFormulas = new Map<number, Formula>();
  private cache = new Map<CellKey, CellValue>();
  private sharedExpressions = new Map<Formula, CellKey>();
  private cachedExpressions = new Map<CellKey, Formula>();
  private parsed = new Map<Formula, Expression<S>>();
  private reverse = new Map<CellKey, Set<CellKey>>();
  private refs = new Map<CellKey, CellKey[]>();
  private ranges = new Map<CellKey, CellRange<S>[]>();
  private limit: number;
  private dependencyCacheEvicted = false;
  evaluations = 0;
  constructor(private options: EngineOptions<S>) {
    this.rows = options.rows;
    this.columns = options.columns;
    if (
      !Number.isSafeInteger(this.rows) ||
      this.rows < 1 ||
      !Number.isSafeInteger(this.columns) ||
      this.columns < 1
    )
      throw new SheetError('INVALID_INPUT', 'Invalid dimensions');
    this.limit = Math.max(1, options.maxCachedFormulas ?? LIMITS.maxCachedFormulas);
    for (const cell of options.cells ?? []) {
      this.validateAddress(cell);
      validateInput(cell.input);
      this.inputs.set(cellKey(cell), cell.input);
    }
    for (const [key, formula] of Object.entries(options.columnFormulas ?? {})) {
      if (formula === undefined) continue;
      const col = Number(key);
      this.validateAddress(Address.unsafe<S>(0, col));
      if (!isFormula(formula))
        throw new SheetError('INVALID_INPUT', 'Column formula must start with =');
      this.columnsWithFormulas.set(col, formula);
    }
  }
  validateAddress(address: Address<S>) {
    if (
      !Number.isInteger(address.row) ||
      !Number.isInteger(address.col) ||
      address.row < 0 ||
      address.col < 0 ||
      address.row >= this.rows ||
      address.col >= this.columns
    )
      throw new SheetError('OUT_OF_BOUNDS', 'Address is outside the sheet');
  }
  input(address: Address<S>): CellInput {
    const stored = this.inputs.get(cellKey(address));
    if (stored !== undefined) return stored;
    const formula = this.columnsWithFormulas.get(address.col);
    if (formula) return shiftFormula(formula, address.row, 0);
    return this.options.readInput?.(address) ?? null;
  }
  columnFormula(col: number): Formula | null {
    return this.columnsWithFormulas.get(col) ?? null;
  }
  private expression(formula: Formula) {
    let expression = this.parsed.get(formula);
    if (!expression) {
      expression = parseFormula<S>(formula);
      if (this.parsed.size >= LIMITS.maxParsedFormulas) {
        const oldest = firstKey(this.parsed);
        if (oldest !== undefined) this.parsed.delete(oldest);
      }
      this.parsed.set(formula, expression);
    }
    return expression;
  }
  private unlink(key: CellKey) {
    this.cache.delete(key);
    const formula = this.cachedExpressions.get(key);
    if (formula && this.sharedExpressions.get(formula) === key)
      this.sharedExpressions.delete(formula);
    this.cachedExpressions.delete(key);
    for (const ref of this.refs.get(key) ?? []) {
      const dependents = this.reverse.get(ref);
      dependents?.delete(key);
      if (!dependents?.size) this.reverse.delete(ref);
    }
    this.refs.delete(key);
    this.ranges.delete(key);
  }
  private invalidate(keys: Iterable<CellKey>) {
    const queue = [...keys];
    const visited = new Set<CellKey>();
    for (let i = 0; i < queue.length; i++) {
      const key = queue[i];
      if (key === undefined || visited.has(key)) continue;
      visited.add(key);
      queue.push(...(this.reverse.get(key) ?? []));
      const address = parseCellKey<S>(key);
      if (!address) continue;
      for (const [dependent, ranges] of this.ranges)
        if (ranges.some((range) => CellRange.contains(range, address))) queue.push(dependent);
    }
    for (const key of visited) this.unlink(key);
  }
  private register(key: CellKey, expression: Expression<S>) {
    const deps = dependencies(expression);
    const refs = deps.cells.map(cellKey);
    this.refs.set(key, refs);
    if (deps.ranges.length) this.ranges.set(key, deps.ranges);
    for (const ref of refs) {
      let dependents = this.reverse.get(ref);
      if (!dependents) this.reverse.set(ref, (dependents = new Set()));
      dependents.add(key);
    }
  }
  value(address: Address<S>, visiting = new Set<CellKey>()): CellValue {
    if (this.options.isPresent && !this.options.isPresent(address))
      return formulaError('#REF!', 'Referenced item was removed');
    if (
      address.row < 0 ||
      address.col < 0 ||
      address.row >= this.rows ||
      address.col >= this.columns
    )
      return formulaError('#REF!', 'Reference is outside the sheet');
    const key = cellKey(address);
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    const input = this.input(address);
    if (typeof input === 'string' && input.startsWith("'")) return input.slice(1);
    if (!isFormula(input)) return input;
    if (visiting.has(key)) return formulaError('#CYCLE!', 'Circular reference');
    if (visiting.size >= LIMITS.maxDependencyDepth)
      return formulaError('#NUM!', `Dependency depth exceeds ${LIMITS.maxDependencyDepth}`);
    const expression = this.expression(input);
    const sharedKey = this.sharedExpressions.get(input);
    const shared = sharedKey === undefined ? undefined : this.cache.get(sharedKey);
    let result: CellValue;
    if (shared !== undefined) result = shared;
    else {
      visiting.add(key);
      this.evaluations++;
      result = evaluate(
        expression,
        (ref) => this.value(ref, visiting),
        this,
        this.options.isPresent,
      );
      visiting.delete(key);
    }
    // Values remain valid within a revision. Once a dependency node is evicted,
    // the next write clears the bounded cache because the graph is incomplete.
    if (this.cache.size >= this.limit) {
      const oldest = firstKey(this.cache);
      if (oldest !== undefined) this.unlink(oldest);
      this.dependencyCacheEvicted = true;
    }
    this.cache.set(key, result);
    this.register(key, expression);
    this.cachedExpressions.set(key, input);
    if (!this.sharedExpressions.has(input)) this.sharedExpressions.set(input, key);
    return result;
  }
  /** Mutation addresses are interpreted in the engine's own coordinate space. */
  apply(mutation: Mutation) {
    switch (mutation.kind) {
      case 'cells': {
        const cells = mutation.cells.map((cell) => ({
          ...cell,
          address: Address.unsafe<S>(cell.row, cell.col),
        }));
        for (const cell of cells) {
          this.validateAddress(cell.address);
          validateInput(cell.input);
        }
        if (this.dependencyCacheEvicted) this.clearCache();
        else this.invalidate(cells.map((cell) => cellKey(cell.address)));
        for (const cell of cells) this.inputs.set(cellKey(cell.address), cell.input);
        return;
      }
      case 'columns': {
        for (const column of mutation.columns) {
          this.validateAddress(Address.unsafe<S>(0, column.col));
          if (column.formula !== null && !isFormula(column.formula))
            throw new SheetError('INVALID_INPUT', 'Column formula must start with =');
        }
        if (mutation.columns.length || this.dependencyCacheEvicted) this.clearCache();
        for (const column of mutation.columns) {
          if (column.formula === null) this.columnsWithFormulas.delete(column.col);
          else this.columnsWithFormulas.set(column.col, column.formula);
        }
        return;
      }
    }
  }
  clearCache() {
    this.cache.clear();
    this.sharedExpressions.clear();
    this.cachedExpressions.clear();
    this.reverse.clear();
    this.refs.clear();
    this.ranges.clear();
    this.dependencyCacheEvicted = false;
  }
  get stats(): EngineStats {
    return {
      inputs: this.inputs.size,
      cachedFormulas: this.cache.size,
      parsedFormulas: this.parsed.size,
      dependencyCells: this.reverse.size,
      rangeDependencies: this.ranges.size,
      evaluations: this.evaluations,
    };
  }
  block(range: CellRange<S>, revision: Revision): DataBlock<S> {
    this.validateAddress(range.start);
    this.validateAddress(range.end);
    if (
      range.end.row < range.start.row ||
      range.end.col < range.start.col ||
      CellRange.size(range) > LIMITS.maxBlockCells
    )
      throw new SheetError('LIMIT_EXCEEDED', 'Invalid block (maximum 20,000 cells)');
    const cells: CellRecord<S>[] = [];
    for (let row = range.start.row; row <= range.end.row; row++)
      for (let col = range.start.col; col <= range.end.col; col++) {
        const address = Address.unsafe<S>(row, col);
        const value = this.value(address);
        cells.push({
          ...address,
          input: this.input(address),
          value,
          status: isError(value) ? 'error' : 'ready',
        });
      }
    return { cells, range, revision };
  }
}

/** Revision checks happen in the same serialized worker as calculations and writes. */
export class EngineSession {
  revision: Revision = Revision.initial;
  constructor(
    readonly engine: FormulaEngine,
    readonly editable: (address: Address) => boolean = () => true,
    readonly columnOnly = false,
  ) {}
  get metadata(): SheetMetadata {
    return { rows: this.engine.rows, columns: this.engine.columns, revision: this.revision };
  }
  block(range: CellRange): DataBlock {
    return this.engine.block(range, this.revision);
  }
  /** Advances the revision after an upstream change made directly on the engine. */
  touch() {
    this.revision = Revision.next(this.revision);
  }
  mutate(mutation: Mutation, revision: Revision): MutationResult {
    if (revision !== this.revision)
      throw new SheetError('REVISION_CONFLICT', 'Revision conflict. Refresh and try again.');
    const addresses =
      mutation.kind === 'cells'
        ? mutation.cells
        : mutation.columns.map((column) => Address.unsafe(0, column.col));
    if (mutation.kind === 'cells') {
      if (mutation.cells.length > LIMITS.maxEditCells)
        throw new SheetError('LIMIT_EXCEEDED', 'Maximum edit size is 10,000 cells');
      if (this.columnOnly && mutation.cells.length)
        throw new SheetError(
          'READ_ONLY',
          'Server source cells are read-only; edit a calculated column',
        );
    }
    for (const address of addresses)
      if (!this.editable(address)) throw new SheetError('READ_ONLY', 'This cell is read-only');
    this.engine.apply(mutation);
    this.touch();
    return { revision: this.revision };
  }
}
