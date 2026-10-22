import type { EventEmitter } from 'node:events';
import type { MessagePort, Worker } from 'node:worker_threads';
import { errorMessage } from '@sheet/core';
import type { RpcEndpoint, RpcScope } from '@sheet/transport';

type Listener =
  ((event: { readonly data: unknown }) => void) | ((event: { readonly message?: string }) => void);
interface Attached {
  readonly event: 'message' | 'error' | 'exit';
  readonly handler: (value: unknown) => void;
}

/** Adapts a Node worker to the browser-shaped endpoint the RPC client expects. */
export function workerEndpoint(worker: Worker): RpcEndpoint {
  const emitter: EventEmitter = worker;
  const attached = new Map<Listener, Attached[]>();
  const attach = (listener: Listener, entries: Attached[]) => {
    attached.set(listener, entries);
    for (const { event, handler } of entries) emitter.on(event, handler);
  };
  return {
    postMessage: (message) => worker.postMessage(message),
    addEventListener(type: 'message' | 'error', listener: Listener) {
      // Both listener shapes accept `{ data, message }`.
      if (type === 'message')
        attach(listener, [{ event: 'message', handler: (data) => listener({ data }) }]);
      else
        attach(listener, [
          {
            event: 'error',
            handler: (error) => listener({ data: undefined, message: errorMessage(error) }),
          },
          {
            event: 'exit',
            handler: (code) =>
              listener({ data: undefined, message: `Calculation worker exited (${String(code)})` }),
          },
        ]);
    },
    removeEventListener(_type: 'message' | 'error', listener: Listener) {
      for (const { event, handler } of attached.get(listener) ?? []) emitter.off(event, handler);
      attached.delete(listener);
    },
    terminate: () => worker.terminate(),
  };
}

/** Adapts a worker's `parentPort` to the scope `serveRpc` listens on. */
export function portScope(port: MessagePort): RpcScope {
  return {
    addEventListener(_type, listener) {
      port.on('message', (data: unknown) => listener({ data }));
    },
    postMessage: (message) => port.postMessage(message),
  };
}
