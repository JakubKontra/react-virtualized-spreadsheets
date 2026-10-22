import { isRecord, isSheetErrorCode, type Brand, type SerializedError } from '@sheet/core';

/**
 * A protocol maps method names to their parameter and result types. Clients and handlers are
 * both derived from it, so a method cannot be called with the wrong payload or left unhandled.
 */
export type ProtocolShape = {
  readonly [method: string]: { readonly params: unknown; readonly result: unknown };
};
export type Method<P extends ProtocolShape> = keyof P & string;
export type Params<P extends ProtocolShape, M extends Method<P>> = P[M]['params'];
export type Result<P extends ProtocolShape, M extends Method<P>> = P[M]['result'];
/** Events pushed from the handler side without a request. */
export type EventShape = { readonly [name: string]: unknown };

export type RequestId = Brand<number, 'RequestId'>;

export type RpcRequest<P extends ProtocolShape> = {
  readonly [M in Method<P>]: {
    readonly kind: 'request';
    readonly id: RequestId;
    readonly method: M;
    readonly params: Params<P, M>;
  };
}[Method<P>];
export type RpcReply =
  | { readonly kind: 'reply'; readonly id: RequestId; readonly ok: true; readonly result: unknown }
  | {
      readonly kind: 'reply';
      readonly id: RequestId;
      readonly ok: false;
      readonly error: SerializedError;
    };
export type RpcEvent<E extends EventShape> = {
  readonly [K in keyof E & string]: {
    readonly kind: 'event';
    readonly name: K;
    readonly data: E[K];
  };
}[keyof E & string];

export type Handlers<P extends ProtocolShape> = {
  readonly [M in Method<P>]: (params: Params<P, M>) => Result<P, M> | Promise<Result<P, M>>;
};

const isRequestId = (value: unknown): value is RequestId =>
  typeof value === 'number' && Number.isSafeInteger(value);

const isSerializedError = (value: unknown): value is SerializedError =>
  isRecord(value) &&
  typeof value['message'] === 'string' &&
  (value['code'] === 'UNKNOWN' || isSheetErrorCode(value['code']));

export function isRpcReply(value: unknown): value is RpcReply {
  if (!isRecord(value) || value['kind'] !== 'reply' || !isRequestId(value['id'])) return false;
  return value['ok'] === true ? 'result' in value : isSerializedError(value['error']);
}

export function isRpcEvent<E extends EventShape>(
  value: unknown,
  names: readonly (keyof E & string)[],
): value is RpcEvent<E> {
  return (
    isRecord(value) &&
    value['kind'] === 'event' &&
    names.some((name) => name === value['name']) &&
    'data' in value
  );
}

/** Narrows an untrusted message to a request for one of the handled methods. */
export function parseRpcRequest<P extends ProtocolShape>(
  value: unknown,
  handlers: Handlers<P>,
): RpcRequest<P> | null {
  if (
    !isRecord(value) ||
    value['kind'] !== 'request' ||
    !isRequestId(value['id']) ||
    typeof value['method'] !== 'string' ||
    !Object.hasOwn(handlers, value['method'])
  )
    return null;
  // The method was checked against the handler table; params are trusted on worker channels
  // and validated by route parsers on untrusted (HTTP) channels.
  return value as RpcRequest<P>;
}
