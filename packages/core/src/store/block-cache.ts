import { firstKey } from '../assert';
import type { Brand, Revision } from '../brand';
import type { CellSnapshot } from '../cell';
import { CellRange, cellKey, type Address, type CellKey } from '../coords';
import { KeyedEmitter } from '../emitter';
import { SheetError } from '../errors';
import { LIMITS } from '../limits';
import type { DataBlock } from '../source';

const EMPTY: CellSnapshot = Object.freeze({ input: null, value: null, status: 'loading' });

/** `blockRow:blockCol`, deliberately incompatible with `CellKey`. */
type BlockKey = Brand<string, 'BlockKey'>;
export interface BlockRef {
  readonly key: BlockKey;
  readonly blockRow: number;
  readonly blockCol: number;
}
interface Block {
  readonly cells: Map<CellKey, CellSnapshot>;
  readonly revision: Revision;
}
interface Flight {
  readonly controller: AbortController;
  readonly promise: Promise<void>;
}

export interface CacheOptions {
  /** Rows per cached block (default 64). */
  readonly blockRows?: number | undefined;
  /** Columns per cached block (default 8). */
  readonly blockColumns?: number | undefined;
  /** Blocks kept in memory (default 48). */
  readonly maxBlocks?: number | undefined;
}
export interface CacheStats {
  readonly blocks: number;
  readonly cells: number;
  readonly inFlight: number;
}

interface BlockCacheHost {
  readonly rows: number;
  readonly columns: number;
  readonly revision: Revision;
  readonly disposed: boolean;
  read(range: CellRange, signal: AbortSignal): Promise<DataBlock>;
  /** A block arrived at a newer revision than the store knows. */
  onNewerRevision(revision: Revision): void;
  onError(error: unknown): void;
  onLoading(inFlight: number): void;
}

/** Bounded LRU of calculated blocks with in-flight deduplication and per-cell notifications. */
export class BlockCache {
  readonly blockRows: number;
  readonly blockColumns: number;
  readonly maxBlocks: number;
  readonly cells = new KeyedEmitter<CellKey>();
  private blocks = new Map<BlockKey, Block>();
  private flights = new Map<BlockKey, Flight>();
  private generation = 0;
  constructor(
    private host: BlockCacheHost,
    options: CacheOptions,
  ) {
    this.blockRows = options.blockRows ?? 64;
    this.blockColumns = options.blockColumns ?? 8;
    this.maxBlocks = options.maxBlocks ?? 48;
    if (
      this.blockRows * this.blockColumns > LIMITS.maxBlockCells ||
      this.blockRows < 1 ||
      this.blockColumns < 1 ||
      this.maxBlocks < 1
    )
      throw new SheetError('INVALID_INPUT', 'Invalid cache configuration');
  }
  private ref(blockRow: number, blockCol: number): BlockRef {
    // Block keys are only ever built here.
    return { key: `${blockRow}:${blockCol}` as BlockKey, blockRow, blockCol };
  }
  private keyOf(address: Address): BlockKey {
    return this.ref(
      Math.floor(address.row / this.blockRows),
      Math.floor(address.col / this.blockColumns),
    ).key;
  }
  read = (address: Address): CellSnapshot =>
    this.blocks.get(this.keyOf(address))?.cells.get(cellKey(address)) ?? EMPTY;
  private range({ blockRow, blockCol }: BlockRef): CellRange {
    return CellRange.unsafe(
      blockRow * this.blockRows,
      blockCol * this.blockColumns,
      Math.min(this.host.rows - 1, (blockRow + 1) * this.blockRows - 1),
      Math.min(this.host.columns - 1, (blockCol + 1) * this.blockColumns - 1),
    );
  }
  refs(range: CellRange): BlockRef[] {
    const refs: BlockRef[] = [];
    const { start, end } = CellRange.normalize(range);
    for (
      let r = Math.floor(start.row / this.blockRows);
      r <= Math.floor(end.row / this.blockRows);
      r++
    )
      for (
        let c = Math.floor(start.col / this.blockColumns);
        c <= Math.floor(end.col / this.blockColumns);
        c++
      )
        refs.push(this.ref(r, c));
    return refs;
  }
  fetch(ref: BlockRef): Promise<void> {
    const { key } = ref;
    const current = this.blocks.get(key);
    if (current?.revision === this.host.revision) {
      this.blocks.delete(key);
      this.blocks.set(key, current);
      return Promise.resolve();
    }
    const existing = this.flights.get(key);
    if (existing) return existing.promise;
    const controller = new AbortController();
    const generation = this.generation;
    const promise = Promise.resolve()
      .then(async () => {
        const result = await this.host.read(this.range(ref), controller.signal);
        if (
          this.host.disposed ||
          controller.signal.aborted ||
          generation !== this.generation ||
          result.revision < this.host.revision
        )
          return;
        if (result.revision > this.host.revision) {
          this.host.onNewerRevision(result.revision);
          return;
        }
        const cells = new Map<CellKey, CellSnapshot>();
        const changed: CellKey[] = [];
        for (const { row, col, ...cell } of result.cells) {
          const key = cellKey({ row, col });
          const previous = current?.cells.get(key);
          const same =
            previous &&
            previous.input === cell.input &&
            previous.value === cell.value &&
            previous.status === cell.status;
          cells.set(key, same ? previous : cell);
          if (!same) changed.push(key);
        }
        this.blocks.delete(key);
        this.blocks.set(key, { cells, revision: result.revision });
        this.cells.emit(changed);
        while (this.blocks.size > this.maxBlocks) {
          const oldest = firstKey(this.blocks);
          const removed = oldest === undefined ? undefined : this.blocks.get(oldest);
          if (oldest === undefined || !removed) break;
          this.blocks.delete(oldest);
          this.cells.emit(removed.cells.keys());
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted && !this.host.disposed) this.host.onError(error);
      })
      .finally(() => {
        if (this.flights.get(key)?.controller === controller) this.flights.delete(key);
        this.host.onLoading(this.flights.size);
      });
    this.flights.set(key, { controller, promise });
    this.host.onLoading(this.flights.size);
    return promise;
  }
  /** Aborts requests for blocks outside `wanted`. */
  retain(wanted: ReadonlySet<BlockKey>) {
    for (const [key, flight] of this.flights)
      if (!wanted.has(key)) {
        flight.controller.abort();
        this.flights.delete(key);
      }
  }
  /** Drops in-flight requests. Without a mapping change, cached cells stay visible as `calculating`. */
  invalidate(mappingChanged: boolean) {
    this.generation++;
    this.abortAll();
    if (mappingChanged) {
      const keys = [...this.blocks.values()].flatMap((block) => [...block.cells.keys()]);
      this.blocks.clear();
      this.cells.emit(keys);
    }
    for (const block of this.blocks.values()) {
      for (const [key, cell] of block.cells)
        block.cells.set(key, { ...cell, status: 'calculating' });
      this.cells.emit(block.cells.keys());
    }
  }
  private abortAll() {
    for (const flight of this.flights.values()) flight.controller.abort();
    this.flights.clear();
  }
  get stats(): CacheStats {
    return {
      blocks: this.blocks.size,
      cells: [...this.blocks.values()].reduce((sum, block) => sum + block.cells.size, 0),
      inFlight: this.flights.size,
    };
  }
  dispose() {
    this.abortAll();
    this.blocks.clear();
    this.cells.clear();
  }
}
