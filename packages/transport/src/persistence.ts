import {
  validateViewState,
  type PersistedView,
  type SheetViewState,
  type ViewController,
  type ViewSummary,
  type ViewPersistenceAdapter,
} from '@sheet/core';

export class LocalStorageViewAdapter implements ViewPersistenceAdapter {
  constructor(
    private storage: Pick<Storage, 'getItem' | 'setItem'>,
    private prefix = 'ledger:view:',
  ) {}
  async list(sourceId: string, signal: AbortSignal): Promise<ViewSummary[]> {
    signal.throwIfAborted();
    return JSON.parse(
      this.storage.getItem(this.prefix + 'catalog:' + sourceId) ?? '[]',
    ) as ViewSummary[];
  }
  async load(viewId: string, signal: AbortSignal): Promise<PersistedView | null> {
    signal.throwIfAborted();
    return this.read(viewId);
  }
  private read(viewId: string): PersistedView | null {
    const raw = this.storage.getItem(this.prefix + viewId);
    if (!raw) return null;
    const result = JSON.parse(raw) as PersistedView;
    validateViewState(result.state);
    if (result.state.viewId !== viewId || typeof result.version !== 'string')
      throw new Error('Invalid saved view');
    return result;
  }
  async save(
    state: SheetViewState,
    expectedVersion: string | null,
    signal: AbortSignal,
  ): Promise<PersistedView> {
    const write = () => {
      signal.throwIfAborted();
      validateViewState(state);
      const current = this.read(state.viewId);
      if ((current?.version ?? null) !== expectedVersion)
        throw new Error('View changed in another tab. Reload or save a separate view.');
      const result = {
        state,
        version: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
      };
      const key = this.prefix + 'catalog:' + state.sourceId;
      const previousCatalog = this.storage.getItem(key) ?? '[]';
      const catalog = JSON.parse(previousCatalog) as ViewSummary[];
      this.storage.setItem(
        key,
        JSON.stringify([
          ...catalog.filter((v) => v.viewId !== state.viewId),
          { viewId: state.viewId, sourceId: state.sourceId, name: state.name ?? state.viewId },
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
export class HttpViewAdapter implements ViewPersistenceAdapter {
  constructor(
    private baseUrl: string,
    private request: typeof fetch = globalThis.fetch,
  ) {}
  async list(sourceId: string, signal: AbortSignal): Promise<ViewSummary[]> {
    const response = await this.request(
      `${this.baseUrl.replace(/\/$/, '')}?sourceId=${encodeURIComponent(sourceId)}`,
      { signal },
    );
    if (!response.ok) throw new Error('Could not list views');
    return response.json();
  }
  private url(viewId: string) {
    return `${this.baseUrl.replace(/\/$/, '')}/${encodeURIComponent(viewId)}`;
  }
  async load(viewId: string, signal: AbortSignal): Promise<PersistedView | null> {
    const response = await this.request(this.url(viewId), { signal });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Could not load view (${response.status})`);
    const result = (await response.json()) as PersistedView;
    validateViewState(result.state);
    if (result.state.viewId !== viewId || typeof result.version !== 'string')
      throw new Error('Server returned an invalid view');
    return result;
  }
  async save(
    state: SheetViewState,
    expectedVersion: string | null,
    signal: AbortSignal,
  ): Promise<PersistedView> {
    const response = await this.request(this.url(state.viewId), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state, expectedVersion }),
      signal,
    });
    if (response.status === 409)
      throw new Error('View changed on the server. Reload or save a separate view.');
    if (!response.ok) throw new Error(`Could not save view (${response.status})`);
    const result = (await response.json()) as PersistedView;
    validateViewState(result.state);
    if (result.state.viewId !== state.viewId || typeof result.version !== 'string')
      throw new Error('Server returned an invalid view');
    return result;
  }
}
export interface ViewSaveStatus {
  status: 'saved' | 'saving' | 'unsaved' | 'error';
  error: string | null;
}
/** Serializes autosaves. Edits during an in-flight save are queued, never dropped. */
export class ViewPersistenceBinding {
  private version: string | null;
  private savedRevision: number;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private flight: Promise<void> | null = null;
  private controller = new AbortController();
  private unsubscribe: () => void;
  private state: ViewSaveStatus = { status: 'saved', error: null };
  private listeners = new Set<() => void>();
  constructor(
    private view: ViewController,
    private adapter: ViewPersistenceAdapter,
    version: string | null = null,
    private delay = 300,
  ) {
    this.version = version;
    this.savedRevision = version === null ? -1 : view.getSnapshot().revision;
    this.unsubscribe = view.subscribe(() => {
      this.update({ status: 'unsaved', error: null });
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        void this.flush();
      }, this.delay);
    });
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(state: ViewSaveStatus) {
    this.state = state;
    this.listeners.forEach((listener) => listener());
  }
  flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.flight) return this.flight;
    if (this.controller.signal.aborted || this.savedRevision === this.view.getSnapshot().revision)
      return Promise.resolve();
    this.flight = (async () => {
      try {
        while (
          !this.controller.signal.aborted &&
          this.savedRevision !== this.view.getSnapshot().revision
        ) {
          const snapshot = this.view.getSnapshot();
          this.update({ status: 'saving', error: null });
          const result = await this.adapter.save(snapshot, this.version, this.controller.signal);
          this.version = result.version;
          this.savedRevision = snapshot.revision;
        }
        if (!this.controller.signal.aborted) this.update({ status: 'saved', error: null });
      } catch (error) {
        if (!this.controller.signal.aborted)
          this.update({
            status: 'error',
            error: error instanceof Error ? error.message : String(error),
          });
      }
    })();
    void this.flight.finally(() => {
      this.flight = null;
    });
    return this.flight;
  }
  dispose() {
    clearTimeout(this.timer);
    this.unsubscribe();
    this.controller.abort();
    this.listeners.clear();
  }
}
