import {
  Emitter,
  errorMessage,
  type Unsubscribe,
  type ViewController,
  type ViewPersistenceAdapter,
  type ViewRevision,
} from '@sheet/core';

export type ViewSaveState = 'saved' | 'saving' | 'unsaved' | 'error';
export type ViewSaveStatus =
  | { readonly status: Exclude<ViewSaveState, 'error'>; readonly error: null }
  | { readonly status: 'error'; readonly error: string };

/** Serializes autosaves. Edits during an in-flight save are queued, never dropped. */
export class ViewPersistenceBinding {
  private version: string | null;
  private savedRevision: ViewRevision | null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private flight: Promise<void> | null = null;
  private controller = new AbortController();
  private unsubscribe: Unsubscribe;
  private state: ViewSaveStatus = { status: 'saved', error: null };
  private emitter = new Emitter();
  constructor(
    private view: ViewController,
    private adapter: ViewPersistenceAdapter,
    version: string | null = null,
    private delay = 300,
  ) {
    this.version = version;
    this.savedRevision = version === null ? null : view.getSnapshot().revision;
    this.unsubscribe = view.subscribe(() => {
      this.update({ status: 'unsaved', error: null });
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        void this.flush();
      }, this.delay);
    });
  }
  getSnapshot = (): ViewSaveStatus => this.state;
  subscribe = (listener: () => void): Unsubscribe => this.emitter.subscribe(listener);
  private update(state: ViewSaveStatus) {
    this.state = state;
    this.emitter.emit();
  }
  private get dirty() {
    return this.savedRevision !== this.view.getSnapshot().revision;
  }
  flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.flight) return this.flight;
    if (this.controller.signal.aborted || !this.dirty) return Promise.resolve();
    const flight = (async () => {
      try {
        while (!this.controller.signal.aborted && this.dirty) {
          const snapshot = this.view.getSnapshot();
          this.update({ status: 'saving', error: null });
          const result = await this.adapter.save(snapshot, this.version, this.controller.signal);
          this.version = result.version;
          this.savedRevision = snapshot.revision;
        }
        if (!this.controller.signal.aborted) this.update({ status: 'saved', error: null });
      } catch (error) {
        if (!this.controller.signal.aborted)
          this.update({ status: 'error', error: errorMessage(error) });
      }
    })();
    this.flight = flight;
    void flight.finally(() => {
      this.flight = null;
    });
    return flight;
  }
  dispose() {
    clearTimeout(this.timer);
    this.unsubscribe();
    this.controller.abort();
    this.emitter.clear();
  }
}
