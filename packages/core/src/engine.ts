import { dependencies, evaluate, parseFormula, shiftFormula, type Expression } from './formula';
import {
  addressFromKey,
  cellKey,
  contains,
  formulaError,
  isError,
  type Address,
  type CellInput,
  type CellPatch,
  type CellRange,
  type CellValue,
  type DataBlock,
  type Mutation,
  type SheetMetadata,
} from './types';

export interface EngineOptions {
  rows: number;
  columns: number;
  cells?: CellPatch[];
  columnFormulas?: Record<number, string>;
  /** A synchronous, complete source. It must never return null for unloaded data. */
  readInput?: (address: Address) => CellInput;
  maxCachedFormulas?: number;
  isPresent?: (address: Address) => boolean;
}
/** Sparse inputs, lazy formula columns, and bounded computed values. No React or DOM dependencies. */
export class FormulaEngine {
  readonly rows: number;
  readonly columns: number;
  private inputs = new Map<string, CellInput>();
  private columnsWithFormulas = new Map<number, string>();
  private cache = new Map<string, CellValue>();
  private sharedExpressions = new Map<string, string>();
  private cachedExpressions = new Map<string, string>();
  private parsed = new Map<string, Expression>();
  private reverse = new Map<string, Set<string>>();
  private refs = new Map<string, string[]>();
  private ranges = new Map<string, CellRange[]>();
  private limit: number;
  private dependencyCacheEvicted = false;
  evaluations = 0;
  constructor(private options: EngineOptions) {
    this.rows = options.rows;
    this.columns = options.columns;
    if (
      !Number.isSafeInteger(this.rows) ||
      this.rows < 1 ||
      !Number.isSafeInteger(this.columns) ||
      this.columns < 1
    )
      throw new Error('Invalid dimensions');
    this.limit = Math.max(1, options.maxCachedFormulas ?? 10000);
    for (const cell of options.cells ?? []) {
      this.validateAddress(cell);
      this.validateInput(cell.input);
      this.inputs.set(cellKey(cell), cell.input);
    }
    for (const [col, formula] of Object.entries(options.columnFormulas ?? {})) {
      this.validateAddress({ row: 0, col: Number(col) });
      if (!formula.startsWith('=')) throw new Error('Column formula must start with =');
      this.columnsWithFormulas.set(Number(col), formula);
    }
  }
  validateAddress(address: Address) {
    if (
      !Number.isInteger(address.row) ||
      !Number.isInteger(address.col) ||
      address.row < 0 ||
      address.col < 0 ||
      address.row >= this.rows ||
      address.col >= this.columns
    )
      throw new Error('Address is outside the sheet');
  }
  private validateInput(input: CellInput) {
    if (input !== null && !['string', 'number', 'boolean'].includes(typeof input))
      throw new Error('Invalid cell input');
    if (typeof input === 'number' && !Number.isFinite(input))
      throw new Error('Cell numbers must be finite');
  }
  input(address: Address): CellInput {
    const key = cellKey(address);
    if (this.inputs.has(key)) return this.inputs.get(key)!;
    const formula = this.columnsWithFormulas.get(address.col);
    if (formula) return shiftFormula(formula, address.row, 0);
    return this.options.readInput?.(address) ?? null;
  }
  columnFormula(col: number) {
    return this.columnsWithFormulas.get(col) ?? null;
  }
  private expression(formula: string) {
    let expression = this.parsed.get(formula);
    if (!expression) {
      expression = parseFormula(formula);
      if (this.parsed.size >= 2048) this.parsed.delete(this.parsed.keys().next().value!);
      this.parsed.set(formula, expression);
    }
    return expression;
  }
  private unlink(key: string) {
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
  private invalidate(keys: Iterable<string>) {
    const queue = [...keys];
    const visited = new Set<string>();
    for (let i = 0; i < queue.length; i++) {
      const key = queue[i];
      if (visited.has(key)) continue;
      visited.add(key);
      queue.push(...(this.reverse.get(key) ?? []));
      const address = addressFromKey(key);
      for (const [dependent, ranges] of this.ranges)
        if (ranges.some((range) => contains(range, address))) queue.push(dependent);
    }
    for (const key of visited) this.unlink(key);
  }
  private register(key: string, expression: Expression) {
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
  value(address: Address, visiting = new Set<string>()): CellValue {
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
    if (this.cache.has(key)) return this.cache.get(key)!;
    const input = this.input(address);
    if (typeof input === 'string' && input.startsWith("'")) return input.slice(1);
    if (typeof input !== 'string' || !input.startsWith('=')) return input;
    if (visiting.has(key)) return formulaError('#CYCLE!', 'Circular reference');
    if (visiting.size >= 256) return formulaError('#NUM!', 'Dependency depth exceeds 256');
    const expression = this.expression(input);
    const sharedKey = this.sharedExpressions.get(input);
    let result: CellValue;
    if (sharedKey && this.cache.has(sharedKey)) result = this.cache.get(sharedKey)!;
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
      this.unlink(this.cache.keys().next().value!);
      this.dependencyCacheEvicted = true;
    }
    this.cache.set(key, result);
    this.register(key, expression);
    this.cachedExpressions.set(key, input);
    if (!this.sharedExpressions.has(input)) this.sharedExpressions.set(input, key);
    return result;
  }
  apply(mutation: Mutation) {
    for (const cell of mutation.cells ?? []) {
      this.validateAddress(cell);
      this.validateInput(cell.input);
    }
    for (const column of mutation.columns ?? []) {
      this.validateAddress({ row: 0, col: column.col });
      if (column.formula !== null && !column.formula.startsWith('='))
        throw new Error('Column formula must start with =');
    }
    if (mutation.columns?.length || this.dependencyCacheEvicted) this.clearCache();
    else this.invalidate((mutation.cells ?? []).map(cellKey));
    for (const column of mutation.columns ?? []) {
      if (column.formula === null) this.columnsWithFormulas.delete(column.col);
      else this.columnsWithFormulas.set(column.col, column.formula);
    }
    for (const cell of mutation.cells ?? []) this.inputs.set(cellKey(cell), cell.input);
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
  get stats() {
    return {
      inputs: this.inputs.size,
      cachedFormulas: this.cache.size,
      parsedFormulas: this.parsed.size,
      dependencyCells: this.reverse.size,
      rangeDependencies: this.ranges.size,
      evaluations: this.evaluations,
    };
  }
  block(range: CellRange, revision: number): DataBlock {
    this.validateAddress(range.start);
    this.validateAddress(range.end);
    const size = (range.end.row - range.start.row + 1) * (range.end.col - range.start.col + 1);
    if (range.end.row < range.start.row || range.end.col < range.start.col || size > 20000)
      throw new Error('Invalid block (maximum 20,000 cells)');
    const cells: DataBlock['cells'] = [];
    for (let row = range.start.row; row <= range.end.row; row++)
      for (let col = range.start.col; col <= range.end.col; col++) {
        const address = { row, col };
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
  revision = 0;
  constructor(
    readonly engine: FormulaEngine,
    readonly editable: (address: Address) => boolean = () => true,
    readonly columnOnly = false,
  ) {}
  get metadata(): SheetMetadata {
    return { rows: this.engine.rows, columns: this.engine.columns, revision: this.revision };
  }
  block(range: CellRange) {
    return this.engine.block(range, this.revision);
  }
  mutate(mutation: Mutation, revision: number) {
    if (revision !== this.revision) throw new Error('Revision conflict. Refresh and try again.');
    if ((mutation.cells?.length ?? 0) > 10000) throw new Error('Maximum edit size is 10,000 cells');
    if (this.columnOnly && mutation.cells?.length)
      throw new Error('Server source cells are read-only; edit a calculated column');
    for (const address of [
      ...(mutation.cells ?? []),
      ...(mutation.columns ?? []).map((column) => ({ row: 0, col: column.col })),
    ]) {
      if (!this.editable(address)) throw new Error('This cell is read-only');
    }
    this.engine.apply(mutation);
    this.revision++;
    return { revision: this.revision };
  }
}
