import type { ReactNode } from 'react';

/** Shortcut reminders; `children` render at the end of the row (the save status). */
export function KeyboardHints({ children }: { readonly children?: ReactNode }) {
  return (
    <div className="keyboard-hints">
      <span>
        <kbd>↵</kbd> Edit cell
      </span>
      <span>
        <kbd>Shift</kbd> + arrows to select
      </span>
      <span>
        <kbd>⌘ / Ctrl</kbd> C / V to copy & paste
      </span>
      {children}
    </div>
  );
}
