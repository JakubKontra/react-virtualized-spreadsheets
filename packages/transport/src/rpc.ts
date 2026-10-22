import { abortError, reviveError, serializeError, SheetError, type Unsubscribe } from '@sheet/core';
import {
  isRpcEvent,
  isRpcReply,
  parseRpcRequest,
  type EventShape,
  type Handlers,
  type Method,
  type Params,
  type ProtocolShape,
  type RequestId,
  type Result,
  type RpcEvent,
  type RpcReply,
  type RpcRequest,
} from './protocol/core';

/** The subset of `Worker` (or a Node worker adapter) the client needs. */
export interface RpcEndpoint {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: { readonly data: unknown }) => void): void;
  addEventListener(type: 'error', listener: (event: { readonly message?: string }) => void): void;
  removeEventListener(type: 'message', listener: (event: { readonly data: unknown }) => void): void;
  removeEventListener(
    type: 'error',
    listener: (event: { readonly message?: string }) => void,
  ): void;
  terminate(): unknown;
}

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
  cleanup(): void;
}

/** Typed request/response client with cancellation, failure propagation and pushed events. */
export class RpcClient<P extends ProtocolShape, E extends EventShape = Record<never, never>> {
  private nextId = 0;
  private pending = new Map<RequestId, Pending>();
  private listeners = new Map<keyof E & string, Set<(data: never) => void>>();
  private disposed = false;
  private failure: Error | null = null;
  private onMessage = (event: { readonly data: unknown }) => {
    const message = event.data;
    if (isRpcReply(message)) this.settle(message);
    else if (isRpcEvent<E>(message, [...this.listeners.keys()])) this.dispatch(message);
  };
  private onError = (event: { readonly message?: string }) => {
    this.failure = new Error(event.message || 'Calculation worker stopped');
    this.fail(this.failure);
  };
  constructor(private endpoint: RpcEndpoint) {
    endpoint.addEventListener('message', this.onMessage);
    endpoint.addEventListener('error', this.onError);
  }
  private settle(reply: RpcReply) {
    const request = this.pending.get(reply.id);
    if (!request) return;
    this.pending.delete(reply.id);
    request.cleanup();
    if (reply.ok) request.resolve(reply.result);
    else request.reject(reviveError(reply.error));
  }
  private dispatch<K extends keyof E & string>(event: RpcEvent<E> & { name: K }) {
    // Listeners are registered per name, so `data` matches what each one expects.
    for (const listener of this.listeners.get(event.name) ?? []) listener(event.data as never);
  }
  request<M extends Method<P>>(
    method: M,
    params: Params<P, M>,
    signal?: AbortSignal,
  ): Promise<Result<P, M>> {
    if (this.disposed) return Promise.reject(new SheetError('DISPOSED', 'Worker is disposed'));
    if (this.failure) return Promise.reject(this.failure);
    if (signal?.aborted) return Promise.reject(abortError());
    this.nextId++;
    // Request ids are only minted here.
    const id = this.nextId as RequestId;
    return new Promise<Result<P, M>>((resolve, reject) => {
      const abort = () => {
        this.pending.delete(id);
        reject(abortError());
      };
      signal?.addEventListener('abort', abort, { once: true });
      this.pending.set(id, {
        // Replies are correlated by id, so the result belongs to method `M`.
        resolve: (value) => resolve(value as Result<P, M>),
        reject,
        cleanup: () => signal?.removeEventListener('abort', abort),
      });
      // A request for one method `M` is a member of the correlated union of all requests.
      const message = { kind: 'request', id, method, params } as RpcRequest<P>;
      try {
        this.endpoint.postMessage(message);
      } catch (error) {
        this.pending.delete(id);
        signal?.removeEventListener('abort', abort);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
  on<K extends keyof E & string>(name: K, listener: (data: E[K]) => void): Unsubscribe {
    let set = this.listeners.get(name);
    if (!set) this.listeners.set(name, (set = new Set()));
    // Listeners are stored per event name, so each one only ever receives `E[K]`.
    const stored = listener as (data: never) => void;
    set.add(stored);
    return () => {
      set.delete(stored);
    };
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
    this.fail(new SheetError('DISPOSED', 'Worker is disposed'));
    this.endpoint.removeEventListener('message', this.onMessage);
    this.endpoint.removeEventListener('error', this.onError);
    this.endpoint.terminate();
    this.listeners.clear();
  }
}

/** The handler side of a channel: a worker global scope or a Node `parentPort` adapter. */
export interface RpcScope {
  addEventListener(type: 'message', listener: (event: { readonly data: unknown }) => void): void;
  postMessage(message: unknown): void;
}

/** Correlated dispatch: TypeScript cannot index a handler table with a union of methods. */
function invoke<P extends ProtocolShape, M extends Method<P>>(
  handlers: Handlers<P>,
  method: M,
  params: Params<P, M>,
): Result<P, M> | Promise<Result<P, M>> {
  return handlers[method](params);
}

export interface RpcServer<E extends EventShape> {
  emit<K extends keyof E & string>(name: K, data: E[K]): void;
}

/** Answers requests on `scope` with `handlers`. Errors are serialized with their codes. */
export function serveRpc<P extends ProtocolShape, E extends EventShape = Record<never, never>>(
  scope: RpcScope,
  handlers: Handlers<P>,
): RpcServer<E> {
  const reply = (message: RpcReply) => scope.postMessage(message);
  scope.addEventListener('message', (event) => {
    const request = parseRpcRequest(event.data, handlers);
    if (!request) return;
    const { id } = request;
    Promise.resolve()
      .then(() => invoke(handlers, request.method, request.params))
      .then(
        (result) => reply({ kind: 'reply', id, ok: true, result }),
        (error: unknown) => reply({ kind: 'reply', id, ok: false, error: serializeError(error) }),
      );
  });
  return {
    emit(name, data) {
      scope.postMessage({ kind: 'event', name, data });
    },
  };
}
