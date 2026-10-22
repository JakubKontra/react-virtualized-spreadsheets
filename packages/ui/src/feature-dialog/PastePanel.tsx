import { useMemo, useRef, useState } from 'react';
import {
  CellRange,
  CLIPBOARD_MIME,
  decodeTSV,
  errorMessage,
  LIMITS,
  PASTE_MODES,
  type PasteMode,
} from '@sheet/core';
import { Button } from '../components/button';
import { Checkbox } from '../components/checkbox';
import { Textarea } from '../components/textarea';
import { OptionRadioGroup } from '../fields/OptionRadioGroup';
import { PASTE_MODE_LABELS, PASTE_MODE_NOTES } from '../lib/labels';
import { optionsFromLabels } from '../lib/options';
import type { PanelProps } from './types';

const MODE_OPTIONS = optionsFromLabels(PASTE_MODES, PASTE_MODE_LABELS);

interface CapturedClipboard {
  readonly text: string;
  /** Internal clipboard token when the copy came from this store and is still current. */
  readonly token: string;
}
interface ClipboardShape {
  readonly rows: number;
  readonly columns: number;
  readonly cells: number;
}

function measure(text: string): ClipboardShape {
  const rows = decodeTSV(text);
  return {
    rows: rows.length,
    columns: rows.reduce((max, row) => Math.max(max, row.length), 0),
    cells: rows.reduce((sum, row) => sum + row.length, 0),
  };
}

export function PastePanel({ store, close }: PanelProps) {
  const [mode, setMode] = useState<PasteMode>('all');
  const [transpose, setTranspose] = useState(false);
  const [clipboard, setClipboard] = useState<CapturedClipboard | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const target = useRef(CellRange.normalize(store.getSnapshot().selection).start).current;
  const shape = useMemo(() => (clipboard ? measure(clipboard.text) : null), [clipboard]);
  const rows = shape ? (transpose ? shape.columns : shape.rows) : 0;
  const columns = shape ? (transpose ? shape.rows : shape.columns) : 0;
  const tooLarge = shape !== null && shape.cells > LIMITS.maxEditCells;
  const apply = async (captured: CapturedClipboard) => {
    setBusy(true);
    setError('');
    try {
      if (captured.token && captured.token !== store.getClipboardToken())
        throw new Error('The copied range changed. Paste it here again.');
      await store.paste(captured.text, {
        mode,
        transpose,
        useInternalFormulas: captured.token !== '',
      });
      close();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <p>Paste a copied range below with Ctrl/⌘ V, then choose how to insert it.</p>
      <label className="paste-capture">
        Copied cells
        <Textarea
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
      <OptionRadioGroup
        className="paste-modes"
        aria-label="Paste mode"
        disabled={busy}
        options={MODE_OPTIONS}
        value={mode}
        onValueChange={setMode}
      />
      <label className="paste-transpose">
        <Checkbox
          aria-label="Transpose rows and columns"
          checked={transpose}
          disabled={busy}
          onCheckedChange={setTranspose}
        />
        Transpose rows and columns
      </label>
      <p className="settings-note">{PASTE_MODE_NOTES[mode]}</p>
      {shape && (
        <p className="paste-preview" role="status">
          {rows} rows × {columns} columns · starting at {store.labelAddress(target)}
        </p>
      )}
      {tooLarge && <p role="alert">Paste at most 10,000 cells.</p>}
      {error && <p role="alert">{error}</p>}
      <div className="dialog-actions">
        <Button variant="outline" onClick={close} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="default"
          disabled={!clipboard || tooLarge || busy}
          onClick={() => {
            if (clipboard) void apply(clipboard);
          }}
        >
          {busy ? 'Pasting…' : 'Apply paste'}
        </Button>
      </div>
    </>
  );
}
