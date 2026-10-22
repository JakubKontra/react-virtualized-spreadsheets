export interface RpcEndpoint {
  postMessage(message: unknown): void;
  addEventListener(type: 'message' | 'error', listener: (event: any) => void): void;
  removeEventListener(type: 'message' | 'error', listener: (event: any) => void): void;
  terminate(): unknown;
}
export interface RpcRequest {
  id: number;
  method: string;
  payload: unknown;
}
export interface RpcReply {
  id: number;
  result?: unknown;
  error?: string;
}
export class WorkerRpc {
  private nextId = 0;
  private pending = new Map<
    number,
    { resolve: (value: any) => void; reject: (error: Error) => void; cleanup: () => void }
  >();
  private disposed = false;
  private failure: Error | null = null;
  private onMessage = (event: MessageEvent<RpcReply>) => {
    const reply = event.data;
    const request = this.pending.get(reply.id);
    if (!request) return;
    this.pending.delete(reply.id);
    request.cleanup();
    if (reply.error) request.reject(new Error(reply.error));
    else request.resolve(reply.result);
  };
  private onError = (event: ErrorEvent) => {
    this.failure = new Error(event.message || 'Calculation worker stopped');
    this.fail(this.failure);
  };
  constructor(private worker: RpcEndpoint) {
    worker.addEventListener('message', this.onMessage);
    worker.addEventListener('error', this.onError);
  }
  request<T>(method: string, payload: unknown, signal?: AbortSignal): Promise<T> {
    if (this.disposed) return Promise.reject(new Error('Worker is disposed'));
    if (this.failure) return Promise.reject(this.failure);
    if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
    const id = ++this.nextId;
    return new Promise<T>((resolve, reject) => {
      const abort = () => {
        this.pending.delete(id);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      signal?.addEventListener('abort', abort, { once: true });
      this.pending.set(id, {
        resolve,
        reject,
        cleanup: () => signal?.removeEventListener('abort', abort),
      });
      try {
        this.worker.postMessage({ id, method, payload });
      } catch (error) {
        this.pending.delete(id);
        signal?.removeEventListener('abort', abort);
        reject(error);
      }
    });
  }
  private fail(error: Error) {
    for (const request of this.pending.values()) {
      request.cleanup();
      request.reject(error);
    }
    this.pending.clear();
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.fail(new Error('Worker is disposed'));
    this.worker.removeEventListener('message', this.onMessage);
    this.worker.removeEventListener('error', this.onError);
    this.worker.terminate();
  }
}
