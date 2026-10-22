import { memo, useEffect, useRef, useState, type HTMLAttributes } from 'react';
import {
  addressLabel,
  columnLabel,
  createSpreadsheet,
  isError,
  parseAddress,
  type SpreadsheetStore,
} from '@sheet/core';
import { useCell, useSpreadsheet } from '@sheet/react';
import { createHttpSource, createLocalSource, WorkerCalculationAdapter } from '@sheet/transport';
import { SALES_COLUMNS, SALES_FORMULAS } from '../../shared/sales';

const widths = [154, 130, 204, 94, 128, 112, 150, 138];
const columnWidth = (col: number) => widths[col] ?? 132;
const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR' });
declare global {
  interface Window {
    __sheet?: SpreadsheetStore;
  }
}

export function App() {
  const [mode, setMode] = useState<'local' | 'remote'>('local');
  const [store, setStore] = useState<SpreadsheetStore | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    let instance: SpreadsheetStore | undefined;
    const controller = new AbortController();
    setStore(null);
    setError('');
    async function load() {
      const source =
        mode === 'local'
          ? createLocalSource({
              metadata: { rows: 100000, columns: 50, revision: 0 },
              columnFormulas: SALES_FORMULAS,
              calculator: new WorkerCalculationAdapter(
                new Worker(new URL('./calculation.worker.ts', import.meta.url), { type: 'module' }),
              ),
            })
          : await createHttpSource({ baseUrl: '/api', signal: controller.signal });
      if (!active) {
        source.dispose();
        return;
      }
      instance = createSpreadsheet({ source });
      setStore(instance);
      if (import.meta.env.DEV) window.__sheet = instance;
    }
    void load().catch((error) => {
      if (active) setError(String(error));
    });
    return () => {
      active = false;
      controller.abort();
      instance?.dispose();
      if (window.__sheet === instance) delete window.__sheet;
    };
  }, [mode, attempt]);
  return (
    <div className="app-shell">
      <aside className="rail" aria-label="Workspace">
        <a className="brand-mark" href="#" aria-label="Ledger home">
          L<span>·</span>
        </a>
        <span className="rail-divider" />
        <span className="rail-item active" title="Spreadsheets">
          ▦
        </span>
        <span className="rail-label">WORKSPACE</span>
        <span className="rail-bottom">LD</span>
      </aside>
      <main>
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <span>/</span> Spreadsheets <span>/</span> <strong>Sales overview</strong>
          </div>
          <span className="version">HEADLESS / V0.1</span>
          <div className="avatar">JK</div>
        </header>
        <section className="page-heading">
          <div>
            <div className="eyebrow">
              <span className="mini-grid">▦</span> LEDGER / SPREADSHEETS
            </div>
            <h1>
              Sales overview<span className="title-dot">.</span>
            </h1>
            <p>A little more clarity. A lot more rows.</p>
          </div>
          <div className="mode-switch" aria-label="Data mode">
            <button className={mode === 'local' ? 'selected' : ''} onClick={() => setMode('local')}>
              Local workbook
            </button>
            <button
              className={mode === 'remote' ? 'selected' : ''}
              onClick={() => setMode('remote')}
            >
              Live server <span className="small-dot" />
            </button>
          </div>
        </section>
        <section className="context-strip">
          <div>
            <span className="context-icon">↗</span>
            <div>
              <strong>
                {mode === 'local' ? 'Your working copy' : 'Connected to the full picture'}
              </strong>
              <span>
                {mode === 'local'
                  ? 'Edit any cell. Your calculations run in the background.'
                  : 'Source sales stay read-only. Add calculations that include every record.'}
              </span>
            </div>
          </div>
          <span className="context-tag">
            {mode === 'local' ? '100,000 rows' : '1,000,000 rows'} <b>×</b> 50 columns
          </span>
        </section>
        {store ? (
          <Sheet key={mode + attempt} store={store} />
        ) : (
          <div className="loading-panel">
            {error ? (
              <>
                <strong>Could not connect</strong>
                <p>{error}</p>
                <button onClick={() => setAttempt((value) => value + 1)}>Try again</button>
              </>
            ) : (
              <>
                <span className="loader" />
                Preparing your spreadsheet…
              </>
            )}
          </div>
        )}
        <footer className="page-footer">
          <span>Built for your interface. Ready for your data.</span>
          <span>
            React hooks <i>·</i> Two-axis virtualization <i>·</i> Worker calculations
          </span>
        </footer>
      </main>
    </div>
  );
}

const Cell = memo(function Cell({
  store,
  row,
  col,
  props,
  left,
  width,
  active,
}: {
  store: SpreadsheetStore;
  row: number;
  col: number;
  props: HTMLAttributes<HTMLElement>;
  left: number;
  width: number;
  active: boolean;
}) {
  const cell = useCell(store, row, col);
  const text = isError(cell.value)
    ? cell.value.error
    : cell.value === null
      ? ''
      : typeof cell.value === 'number'
        ? col === 5
          ? `${number.format(cell.value * 100)}%`
          : [4, 6, 7].includes(col)
            ? money.format(cell.value)
            : number.format(cell.value)
        : String(cell.value);
  return (
    <div
      {...props}
      className={`cell ${col >= 3 ? 'numeric' : ''} ${col >= 6 ? 'computed' : ''} ${active ? 'current' : ''} ${cell.status === 'error' ? 'cell-error' : ''} ${cell.status === 'calculating' ? 'calculating' : ''}`}
      style={{ left, width }}
      title={
        isError(cell.value)
          ? cell.value.message
          : typeof cell.input === 'string' && cell.input.startsWith('=')
            ? cell.input
            : undefined
      }
      data-status={cell.status}
    >
      {cell.status === 'loading' ? <span className="skeleton" /> : <span>{text}</span>}
      {active && <span className="cell-handle" />}
    </div>
  );
});
function Sheet({ store }: { store: SpreadsheetStore }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLInputElement>(null);
  const sheet = useSpreadsheet({ store, scrollRef, columnWidth });
  const { state } = sheet;
  const [jump, setJump] = useState('A1');
  const selected = state.selection.end;
  const current = useCell(store, selected.row, selected.col);
  const [formula, setFormula] = useState('');
  const formulaFocused = useRef(false);
  useEffect(() => {
    setJump(addressLabel(selected));
    setFormula(String(store.readCell(selected).input ?? ''));
  }, [selected.row, selected.col, store]);
  useEffect(() => {
    if (!formulaFocused.current) setFormula(String(current.input ?? ''));
  }, [current.input]);
  useEffect(() => {
    if (state.editing) editorRef.current?.focus();
  }, [state.editing]);
  const act = (promise: Promise<unknown>) => {
    void promise.catch((error) => store.setError(error));
  };
  const isRemote = store.source.mode === 'remote';
  return (
    <section className="sheet-panel" aria-label="Sales workbook">
      <div className="sheet-toolbar">
        <div className="sheet-title">
          <span className="sheet-icon">▦</span>
          <strong>October sales</strong>
          <span className="badge">{isRemote ? 'LIVE DATA' : 'WORKBOOK'}</span>
        </div>
        <div className="toolbar-actions">
          <button
            aria-label="Undo"
            title="Undo (Ctrl/⌘ Z)"
            disabled={!state.canUndo || state.pending}
            onClick={() => act(store.undo())}
          >
            ↶
          </button>
          <button
            aria-label="Redo"
            title="Redo (Ctrl/⌘ Shift Z)"
            disabled={!state.canRedo || state.pending}
            onClick={() => act(store.redo())}
          >
            ↷
          </button>
          <span className="toolbar-separator" />
          <button
            className="calculation-button"
            onClick={() => {
              sheet.select({ row: 0, col: 8 });
              act(
                store
                  .ensureRange({ start: { row: 0, col: 8 }, end: { row: 0, col: 8 } })
                  .then(() => sheet.startEdit(`=SUM($D$1:$D$${store.rows})`, { row: 0, col: 8 })),
              );
            }}
          >
            ƒx <span>Add calculation</span>
          </button>
        </div>
      </div>
      <div className="formula-bar">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const address = parseAddress(jump);
            if (!address) {
              store.setError(new Error('Enter an address such as A100'));
              return;
            }
            try {
              sheet.select(address);
              scrollRef.current?.focus();
            } catch (error) {
              store.setError(error);
            }
          }}
        >
          <input
            aria-label="Go to cell"
            value={jump}
            onChange={(event) => setJump(event.target.value)}
            spellCheck={false}
          />
          <span>⌄</span>
        </form>
        <span className="formula-symbol">ƒx</span>
        <input
          aria-label="Formula bar"
          value={formula}
          placeholder={
            isRemote
              ? 'Select a calculated column to write a formula'
              : 'Select a cell or write a formula, e.g. =SUM(D1:D100000)'
          }
          disabled={
            !store.source.isEditable(selected) ||
            state.pending ||
            current.status === 'loading' ||
            current.status === 'calculating'
          }
          onFocus={() => {
            formulaFocused.current = true;
          }}
          onBlur={() => {
            formulaFocused.current = false;
          }}
          onChange={(event) => setFormula(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              formulaFocused.current = false;
              void sheet.commitEdit(formula);
            }
            if (event.key === 'Escape') {
              setFormula(String(current.input ?? ''));
              scrollRef.current?.focus();
            }
          }}
          spellCheck={false}
        />
        {isRemote && selected.col >= 6 && (
          <span className="formula-hint">Applies to column {columnLabel(selected.col)}</span>
        )}
      </div>
      {state.error && (
        <div className="error-banner" role="alert">
          <span>{state.error}</span>
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
      )}
      <div {...sheet.gridProps} ref={scrollRef} className="grid-scroll" data-testid="grid">
        <div className="grid-canvas" style={{ width: sheet.totalWidth, height: sheet.totalHeight }}>
          <div className="column-headers" role="row" style={{ width: sheet.totalWidth }}>
            <div className="corner" role="columnheader">
              ◩
            </div>
            {sheet.virtualColumns.map((col) => (
              <div
                role="columnheader"
                aria-colindex={col.index + 1}
                key={col.key}
                className={`column-header ${col.index >= 6 ? 'formula-column' : ''}`}
                style={{ left: col.start, width: col.size }}
              >
                <span className="column-letter">{columnLabel(col.index)}</span>
                <span>{SALES_COLUMNS[col.index] ?? 'Calculation'}</span>
                {col.index >= 6 && <em>ƒx</em>}
              </div>
            ))}
          </div>
          {sheet.virtualRows.map((row) => (
            <div
              role="row"
              aria-rowindex={row.index + 1}
              key={row.key}
              className="grid-row"
              style={{ top: row.start, width: sheet.totalWidth, height: row.size }}
            >
              <div
                role="rowheader"
                className={`row-header ${selected.row === row.index ? 'selected' : ''}`}
              >
                {number.format(row.index + 1)}
              </div>
              {sheet.virtualColumns.map((col) => (
                <Cell
                  key={col.key}
                  store={store}
                  row={row.index}
                  col={col.index}
                  props={sheet.getCellProps({ row: row.index, col: col.index })}
                  left={col.start}
                  width={col.size}
                  active={selected.row === row.index && selected.col === col.index}
                />
              ))}
            </div>
          ))}
          {state.editing && (
            <input
              {...sheet.editorProps}
              ref={editorRef}
              className="cell-editor"
              style={sheet.cellRect(state.editing)}
              spellCheck={false}
            />
          )}
        </div>
      </div>
      <div className="sheet-bottom">
        <div className="sheet-tab">
          <span>▦</span> Sales <span className="tab-chevron">⌄</span>
        </div>
        <div className="sheet-status" aria-live="polite">
          <span className={`status-dot ${state.connection === 'disconnected' ? 'offline' : ''}`} />
          {state.connection === 'disconnected'
            ? 'Disconnected · showing last values'
            : state.pending
              ? 'Saving changes…'
              : state.loading
                ? 'Calculating…'
                : isRemote
                  ? 'Live · updates every 4 seconds'
                  : 'All calculations up to date'}
        </div>
        <span className="sheet-size">
          {number.format(store.rows)} rows <span>·</span> {store.columns} columns
        </span>
      </div>
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
        <span className="revision">Revision {state.revision}</span>
      </div>
    </section>
  );
}
