import {
  parsePersistedView,
  parseViewSummaries,
  parse,
  SheetError,
  validateViewState,
  type PersistedView,
  type SheetViewState,
  type SourceId,
  type ViewId,
  type ViewPersistenceAdapter,
  type ViewSummary,
} from '@sheet/core';

const newVersion = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

/** Saves views in `localStorage` with compare-and-set versions across tabs. */
export class LocalStorageViewAdapter implements ViewPersistenceAdapter {
  constructor(
    private storage: Pick<Storage, 'getItem' | 'setItem'>,
    private prefix = 'ledger:view:',
  ) {}
  private catalogKey(sourceId: SourceId) {
    return `${this.prefix}catalog:${sourceId}`;
  }
  private catalog(sourceId: SourceId): ViewSummary[] {
    return parse.parseJson(
      this.storage.getItem(this.catalogKey(sourceId)) ?? '[]',
      parseViewSummaries,
    );
  }
  async list(sourceId: SourceId, signal: AbortSignal): Promise<ViewSummary[]> {
    signal.throwIfAborted();
    return this.catalog(sourceId);
  }
  async load(viewId: ViewId, signal: AbortSignal): Promise<PersistedView | null> {
    signal.throwIfAborted();
    return this.read(viewId);
  }
  private read(viewId: ViewId): PersistedView | null {
    const raw = this.storage.getItem(this.prefix + viewId);
    if (!raw) return null;
    const result = parse.parseJson(raw, parsePersistedView);
    if (result.state.viewId !== viewId)
      throw new SheetError('INVALID_DOCUMENT', 'Invalid saved view');
    return result;
  }
  async save(
    state: SheetViewState,
    expectedVersion: string | null,
    signal: AbortSignal,
  ): Promise<PersistedView> {
    const write = (): PersistedView => {
      signal.throwIfAborted();
      validateViewState(state);
      const current = this.read(state.viewId);
      if ((current?.version ?? null) !== expectedVersion)
        throw new SheetError(
          'REVISION_CONFLICT',
          'View changed in another tab. Reload or save a separate view.',
        );
      const result: PersistedView = { state, version: newVersion() };
      const key = this.catalogKey(state.sourceId);
      const previousCatalog = this.storage.getItem(key) ?? '[]';
      const summary: ViewSummary = {
        viewId: state.viewId,
        sourceId: state.sourceId,
        name: state.name ?? state.viewId,
      };
      this.storage.setItem(
        key,
        JSON.stringify([
          ...this.catalog(state.sourceId).filter((v) => v.viewId !== state.viewId),
          summary,
        ]),
      );
      try {
        this.storage.setItem(this.prefix + state.viewId, JSON.stringify(result));
      } catch (error) {
        this.storage.setItem(key, previousCatalog);
        throw error;
      }
      return result;
    };
    // Web Locks make compare-and-set atomic across cooperating browser tabs.
    if (typeof navigator !== 'undefined' && navigator.locks)
      return navigator.locks.request(this.prefix + 'catalog', { signal }, write);
    return write();
  }
}
