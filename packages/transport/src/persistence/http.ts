import {
  parsePersistedView,
  parseViewSummaries,
  SheetError,
  type PersistedView,
  type SheetViewState,
  type SourceId,
  type ViewId,
  type ViewPersistenceAdapter,
  type ViewSummary,
} from '@sheet/core';

/** Saves views through a REST endpoint (`GET ?sourceId=`, `GET /:id`, `PUT /:id`). */
export class HttpViewAdapter implements ViewPersistenceAdapter {
  constructor(
    private baseUrl: string,
    private request: typeof fetch = globalThis.fetch,
  ) {}
  private get base() {
    return this.baseUrl.replace(/\/$/, '');
  }
  private url(viewId: ViewId) {
    return `${this.base}/${encodeURIComponent(viewId)}`;
  }
  async list(sourceId: SourceId, signal: AbortSignal): Promise<ViewSummary[]> {
    const response = await this.request(`${this.base}?sourceId=${encodeURIComponent(sourceId)}`, {
      signal,
    });
    if (!response.ok) throw new SheetError('REQUEST_FAILED', 'Could not list views');
    return parseViewSummaries(await response.json());
  }
  private async view(response: Response, viewId: ViewId): Promise<PersistedView> {
    const result = parsePersistedView(await response.json());
    if (result.state.viewId !== viewId)
      throw new SheetError('INVALID_DOCUMENT', 'Server returned an invalid view');
    return result;
  }
  async load(viewId: ViewId, signal: AbortSignal): Promise<PersistedView | null> {
    const response = await this.request(this.url(viewId), { signal });
    if (response.status === 404) return null;
    if (!response.ok)
      throw new SheetError('REQUEST_FAILED', `Could not load view (${response.status})`);
    return this.view(response, viewId);
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
      throw new SheetError(
        'REVISION_CONFLICT',
        'View changed on the server. Reload or save a separate view.',
      );
    if (!response.ok)
      throw new SheetError('REQUEST_FAILED', `Could not save view (${response.status})`);
    return this.view(response, state.viewId);
  }
}
