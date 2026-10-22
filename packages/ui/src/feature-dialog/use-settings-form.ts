import { useState, type FormEvent } from 'react';
import { errorMessage } from '@sheet/core';

export interface SettingsForm {
  readonly error: string;
  setError(message: string): void;
  /** Form submit handler: applies the settings and closes, or shows the error. */
  submit(apply: () => void): (event: FormEvent<HTMLFormElement>) => void;
  /** Runs an action from a button; closes on success. */
  run(apply: () => void): void;
}

export function useSettingsForm(close: () => void): SettingsForm {
  const [error, setError] = useState('');
  const run = (apply: () => void) => {
    try {
      apply();
      close();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };
  return {
    error,
    setError,
    run,
    submit: (apply) => (event) => {
      event.preventDefault();
      run(apply);
    },
  };
}
