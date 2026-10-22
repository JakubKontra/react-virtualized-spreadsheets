/**
 * Nominal typing for primitives. The brand is a string-keyed phantom property (not a `unique symbol`)
 * so that separately emitted `.d.ts` copies of `@sheet/core` stay mutually assignable.
 */
export type Brand<T, B extends string> = T & { readonly '~brand': B };

/** Data revision of a source. Increments on every accepted mutation. */
export type Revision = Brand<number, 'Revision'>;
/** Revision of a `SheetViewState` document. Independent of the data revision. */
export type ViewRevision = Brand<number, 'ViewRevision'>;
export type ViewId = Brand<string, 'ViewId'>;
export type SourceId = Brand<string, 'SourceId'>;
/** Stable row identity reported by a data source. */
export type RowId = Brand<string, 'RowId'>;
/** Stable column identity reported by a data source. */
export type ColumnId = Brand<string, 'ColumnId'>;

export const Revision = {
  initial: 0 as Revision,
  unsafe: (value: number) => value as Revision,
  next: (revision: Revision) => (revision + 1) as Revision,
  isValid: (value: unknown): value is Revision =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0,
} as const;

export const ViewRevision = {
  initial: 0 as ViewRevision,
  unsafe: (value: number) => value as ViewRevision,
  next: (revision: ViewRevision) => (revision + 1) as ViewRevision,
} as const;

export const ViewId = { unsafe: (value: string) => value as ViewId } as const;
export const SourceId = { unsafe: (value: string) => value as SourceId } as const;
export const RowId = { unsafe: (value: string) => value as RowId } as const;
export const ColumnId = { unsafe: (value: string) => value as ColumnId } as const;
