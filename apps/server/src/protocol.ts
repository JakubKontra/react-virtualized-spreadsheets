import type { CalculationProtocol, RemoteMetadata } from '@sheet/transport';

/** The demo worker answers the calculation protocol plus metadata and a simulated upstream tick. */
export type ServerProtocol = Omit<CalculationProtocol, 'mutate'> & {
  readonly mutate: {
    readonly params: CalculationProtocol['mutate']['params'];
    readonly result: RemoteMetadata;
  };
  readonly meta: { readonly params: null; readonly result: RemoteMetadata };
  readonly tick: { readonly params: null; readonly result: RemoteMetadata };
};
/** Pushed after every revision change, forwarded to SSE clients. */
export type ServerEvents = { readonly metadata: RemoteMetadata };
export const SERVER_EVENTS = ['metadata'] as const satisfies readonly (keyof ServerEvents)[];

export interface WorkerOptions {
  readonly rows: number;
  readonly tickMs: number;
}
