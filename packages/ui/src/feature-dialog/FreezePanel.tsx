import { useState } from 'react';
import { LIMITS, type FrozenPanes } from '@sheet/core';
import { Button } from '../components/button';
import { IntegerInput } from '../fields/IntegerInput';
import type { ViewPanelProps } from './types';
import { useSettingsForm } from './use-settings-form';

const NONE: FrozenPanes = { rows: 0, columns: 0 };

export function FreezePanel({ store, view, close }: ViewPanelProps) {
  const initial = view.getSnapshot().frozen ?? NONE;
  const [rows, setRows] = useState<number | null>(initial.rows);
  const [columns, setColumns] = useState<number | null>(initial.columns);
  const form = useSettingsForm(close);
  const maxRows = Math.min(store.rows, LIMITS.maxFrozenRows);
  const maxColumns = Math.min(store.columns, LIMITS.maxFrozenColumns);
  return (
    <form
      onSubmit={form.submit(() => {
        if (rows === null || columns === null)
          throw new Error(`Freeze up to ${maxRows} rows and ${maxColumns} columns`);
        store.configure({ frozen: { rows, columns } });
      })}
    >
      <p>Keep the first rows and columns visible while scrolling.</p>
      <label className="stack-field">
        Frozen rows
        <IntegerInput
          autoFocus
          min={0}
          max={maxRows}
          defaultValue={initial.rows}
          onValueChange={setRows}
        />
      </label>
      <label className="stack-field">
        Frozen columns
        <IntegerInput
          min={0}
          max={maxColumns}
          defaultValue={initial.columns}
          onValueChange={setColumns}
        />
      </label>
      <p className="settings-note">
        On small screens, only panes that fit are pinned. The saved setting stays the same.
      </p>
      {form.error && <p role="alert">{form.error}</p>}
      <div className="dialog-actions">
        <Button
          variant="outline"
          type="button"
          onClick={() => form.run(() => store.configure({ frozen: NONE }))}
        >
          Unfreeze all
        </Button>
        <Button variant="default" type="submit">
          Apply freeze
        </Button>
      </div>
    </form>
  );
}
