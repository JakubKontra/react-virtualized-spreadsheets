import type { SpreadsheetStore } from '@sheet/core';

export function ErrorBanner({
  store,
  error,
}: {
  readonly store: SpreadsheetStore;
  readonly error: string;
}) {
  return (
    <div className="error-banner" role="alert">
      <span>{error}</span>
      <button
        onClick={() => {
          store.clearError();
          store.refresh();
        }}
      >
        Retry
      </button>
      <button onClick={() => store.clearError()} aria-label="Dismiss error">
        ×
      </button>
    </div>
  );
}
