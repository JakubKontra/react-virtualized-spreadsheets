import { useMemo, useRef, useState } from 'react';
import {
  CLIPBOARD_MIME,
  decodeTSV,
  normalizeRange,
  type PasteOptions,
  type SpreadsheetStore,
} from '@sheet/core';

export function PastePanel({ store, close }: { store: SpreadsheetStore; close: () => void }) {
  const [mode, setMode] = useState<NonNullable<PasteOptions['mode']>>('all');
  const [transpose, setTranspose] = useState(false);
  const [clipboard, setClipboard] = useState<{ text: string; token: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const target = useRef(normalizeRange(store.getSnapshot().selection).start).current;
  const shape = useMemo(() => {
    if (!clipboard) return null;
    const rows = decodeTSV(clipboard.text);
    return {
      rows: rows.length,
      columns: rows.reduce((max, row) => Math.max(max, row.length), 0),
      cells: rows.reduce((sum, row) => sum + row.length, 0),
    };
  }, [clipboard]);
  const rows = shape ? (transpose ? shape.columns : shape.rows) : 0;
  const columns = shape ? (transpose ? shape.rows : shape.columns) : 0;
  const tooLarge = shape && shape.cells > 10000;
  return (
    <>
      <p>Paste a copied range below with Ctrl/⌘ V, then choose how to insert it.</p>
      <label className="paste-capture">
        Copied cells
        <textarea
          autoFocus
          readOnly
          value={clipboard?.text ?? ''}
          placeholder="Click here and press Ctrl/⌘ V"
          onPaste={(event) => {
            event.preventDefault();
            if (busy) return;
            const token = event.clipboardData.getData(CLIPBOARD_MIME);
            setClipboard({
              text: event.clipboardData.getData('text/plain'),
              token: token && token === store.getClipboardToken() ? token : '',
            });
            setError('');
          }}
        />
      </label>
      <fieldset className="paste-modes" disabled={busy}>
        <legend>Paste mode</legend>
        {(
          [
            ['all', 'Original contents'],
            ['values', 'Values only'],
            ['formulas', 'Formulas only'],
          ] as const
        ).map(([value, label]) => (
          <label key={value}>
            <input
              type="radio"
              name="paste-mode"
              value={value}
              checked={mode === value}
              onChange={() => setMode(value)}
            />
            {label}
          </label>
        ))}
      </fieldset>
      <label className="paste-transpose">
        <input
          type="checkbox"
          checked={transpose}
          disabled={busy}
          onChange={(e) => setTranspose(e.target.checked)}
        />
        Transpose rows and columns
      </label>
      <p className="settings-note">
        {mode === 'formulas'
          ? 'Only formulas overwrite cells. Other target cells stay unchanged.'
          : mode === 'values'
            ? 'Insert results without formulas. Text beginning with = stays text.'
            : 'Internal copies retain formulas and adjust relative references.'}
      </p>
      {shape && (
        <p className="paste-preview" role="status">
          {rows} rows × {columns} columns · starting at {store.labelAddress(target)}
        </p>
      )}
      {tooLarge && <p role="alert">Paste at most 10,000 cells.</p>}
      {error && <p role="alert">{error}</p>}
      <div className="dialog-actions">
        <button onClick={close} disabled={busy}>
          Cancel
        </button>
        <button
          className="primary"
          disabled={!clipboard || !!tooLarge || busy}
          onClick={async () => {
            if (!clipboard) return;
            setBusy(true);
            setError('');
            try {
              if (clipboard.token && clipboard.token !== store.getClipboardToken())
                throw new Error('The copied range changed. Paste it here again.');
              await store.paste(clipboard.text, {
                mode,
                transpose,
                useInternalFormulas: !!clipboard.token,
              });
              close();
            } catch (error) {
              setError(error instanceof Error ? error.message : 'Could not paste cells');
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Pasting…' : 'Apply paste'}
        </button>
      </div>
    </>
  );
}
