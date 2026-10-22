export const SHEET_ERROR_CODES = [
  'REVISION_CONFLICT',
  'READ_ONLY',
  'OUT_OF_BOUNDS',
  'LIMIT_EXCEEDED',
  'INVALID_INPUT',
  'INVALID_DOCUMENT',
  'DISPOSED',
  'BUSY',
  'DISCONNECTED',
  'REQUEST_FAILED',
  'UNSUPPORTED',
] as const;
export type SheetErrorCode = (typeof SHEET_ERROR_CODES)[number];

/** Every error raised by `@sheet/*` carries a machine-readable code next to its user-facing message. */
export class SheetError extends Error {
  override readonly name = 'SheetError';
  constructor(
    readonly code: SheetErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** Wire format for errors crossing a worker or HTTP boundary. */
export interface SerializedError {
  readonly code: SheetErrorCode | 'UNKNOWN';
  readonly message: string;
}

export const isSheetErrorCode = (value: unknown): value is SheetErrorCode =>
  SHEET_ERROR_CODES.some((code) => code === value);

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function serializeError(error: unknown): SerializedError {
  return {
    code: error instanceof SheetError ? error.code : 'UNKNOWN',
    message: errorMessage(error),
  };
}

export function reviveError(error: SerializedError): Error {
  return error.code === 'UNKNOWN'
    ? new Error(error.message)
    : new SheetError(error.code, error.message);
}

export const isAbortError = (error: unknown): boolean =>
  error instanceof DOMException && error.name === 'AbortError';

export const abortError = () => new DOMException('Aborted', 'AbortError');
