import {
  memo,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type HTMLAttributes,
} from 'react';
import {
  columnLabel,
  createSpreadsheet,
  createViewState,
  isError,
  formatCellValue,
  matchesFilter,
  type SpreadsheetStore,
} from '@sheet/core';
import { useCell, useSpreadsheet } from '@sheet/react';
import {
  createHttpSource,
  createLocalSource,
  WorkerCalculationAdapter,
  LocalStorageViewAdapter,
  ViewPersistenceBinding,
} from '@sheet/transport';
import { SALES_COLUMNS, SALES_FORMULAS } from '../../shared/sales';
import { ViewControls } from './ViewControls';
import { FeatureControls } from './FeatureControls';

const widths = [154, 130, 204, 94, 128, 112, 150, 138];
const columnWidth = (col: number) => widths[col] ?? 132;
const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
declare global {
  interface Window {
    __sheet?: SpreadsheetStore;
  }
}

export function App() {
  const [activeViews, setActiveViews] = useState(() => ({
    local: localStorage.getItem('ledger:active:local') ?? 'sales-local-v1',
    remote: localStorage.getItem('ledger:active:remote') ?? 'sales-remote-v1',
  }));
  const [mode, setMode] = useState<'local' | 'remote'>('local');
  const [store, setStore] = useState<SpreadsheetStore | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState<ViewPersistenceBinding | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    let instance: SpreadsheetStore | undefined;
    let binding: ViewPersistenceBinding | undefined;
    const controller = new AbortController();
    setStore(null);
    setSaving(null);
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
      const adapter = new LocalStorageViewAdapter(localStorage);
      const viewId = activeViews[mode];
      let saved;
      try {
        saved = await adapter.load(viewId, controller.signal);
      } catch (error) {
        source.dispose();
        throw error;
      }
      if (!active) {
        source.dispose();
        return;
      }
      const viewState =
        saved?.state ??
        createViewState(source, {
          viewId,
          sourceId: `sales-${mode}`,
          ownedColumns: Array.from({ length: 44 }, (_, i) => i + 6),
          labels: Object.fromEntries(SALES_COLUMNS.map((name, index) => [index, name])),
        });
      if (!saved) {
        viewState.name = 'October sales';
        viewState.columnOptions = {
          1: { kind: 'date' },
          3: { kind: 'number', decimals: 0 },
          4: { kind: 'currency', currency: 'EUR' },
          5: { kind: 'percent' },
          6: { kind: 'currency', currency: 'EUR' },
          7: { kind: 'currency', currency: 'EUR' },
        };
      }
      instance = createSpreadsheet({ source, viewState });
      binding = new ViewPersistenceBinding(instance.view!, adapter, saved?.version ?? null);
      if (saved && !viewState.name) instance.view!.replace({ ...viewState, name: 'October sales' });
      setSaving(binding);
      setStore(instance);
      if (import.meta.env.DEV) window.__sheet = instance;
    }
    void load().catch((error) => {
      if (active) setError(String(error));
    });
    return () => {
      active = false;
      controller.abort();
      binding?.dispose();
      instance?.dispose();
      if (window.__sheet === instance) delete window.__sheet;
    };
  }, [mode, attempt, activeViews]);
  async function switchMode(next: 'local' | 'remote') {
    try {
      const state = store?.getSnapshot();
      if (state?.editing) {
        if (String(store!.readCell(state.editing).input ?? '') === (state.draft ?? ''))
          store!.cancelEdit();
        else
          await store!.edit([
            { ...state.editing, input: store!.parseInput(state.draft ?? '', state.editing) },
          ]);
      }
      await saving?.flush();
      if (saving?.getSnapshot().status !== 'error') setMode(next);
    } catch (error) {
      store?.setError(error);
    }
  }
  async function switchView(id: string) {
    try {
      const state = store?.getSnapshot();
      if (state?.editing)
        await store!.edit([
          { ...state.editing, input: store!.parseInput(state.draft ?? '', state.editing) },
        ]);
      await saving?.flush();
      if (saving?.getSnapshot().status === 'error') throw new Error(saving.getSnapshot().error!);
      localStorage.setItem(`ledger:active:${mode}`, id);
      setActiveViews((previous) => ({ ...previous, [mode]: id }));
    } catch (error) {
      store?.setError(error);
    }
  }
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
            <button
              className={mode === 'local' ? 'selected' : ''}
              onClick={() => {
                void switchMode('local');
              }}
            >
              Local workbook
            </button>
            <button
              className={mode === 'remote' ? 'selected' : ''}
              onClick={() => {
                void switchMode('remote');
              }}
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
          <Sheet
            key={mode + attempt + activeViews[mode]}
            store={store}
            saving={saving!}
            onSwitchView={switchView}
          />
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
  frozen,
  handle,
  toggle,
}: {
  store: SpreadsheetStore;
  row: number;
  col: number;
  props: HTMLAttributes<HTMLElement>;
  left: number;
  width: number;
  active: boolean;
  frozen: boolean;
  toggle: (row: number, col: number, value: boolean) => Promise<void>;
  handle?: import('react').ButtonHTMLAttributes<HTMLButtonElement>;
}) {
  const cell = useCell(store, row, col);
  const canonicalCol = store.view?.columns.canonicalAt(col) ?? col;
  const option = store.columnOptions(col);
  const text = formatCellValue(
    cell.value,
    option ??
      ([4, 6, 7].includes(canonicalCol)
        ? { kind: 'currency' }
        : canonicalCol === 5
          ? { kind: 'percent' }
          : undefined),
    'en-US',
  );
  const rule = store.view
    ?.getSnapshot()
    .conditionalRules?.find((r) => r.col === canonicalCol && matchesFilter(cell.value, r));
  return (
    <div
      {...props}
      className={`cell ${canonicalCol >= 3 ? 'numeric' : ''} ${store.view?.columns.isOwned(col) ? 'computed' : ''} ${active ? 'current' : ''} ${frozen ? 'frozen-cell' : ''} ${cell.status === 'error' ? 'cell-error' : ''} ${cell.status === 'calculating' ? 'calculating' : ''}`}
      style={{
        left,
        width,
        ...(rule
          ? {
              color: rule.color,
              background: rule.background,
              fontWeight: rule.bold ? 700 : undefined,
            }
          : {}),
        ...props.style,
      }}
      title={
        isError(cell.value)
          ? cell.value.message
          : typeof cell.input === 'string' && cell.input.startsWith('=')
            ? cell.input
            : undefined
      }
      data-status={cell.status}
    >
      {cell.status === 'loading' ? (
        <span className="skeleton" />
      ) : option?.kind === 'checkbox' &&
        (typeof cell.value === 'boolean' || cell.value === null) ? (
        <input
          type="checkbox"
          aria-label={`Toggle ${store.labelAddress({ row, col })}`}
          checked={cell.value === true}
          disabled={!store.source.isEditable({ row, col }) || cell.status === 'calculating'}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => {
            void toggle(row, col, e.target.checked).catch((error) => store.setError(error));
          }}
        />
      ) : (
        <span>{text}</span>
      )}
      {handle && (
        <button
          {...handle}
          className="cell-handle"
          title="Drag to fill · arrow keys extend one cell"
        />
      )}
    </div>
  );
});
function Sheet({
  store,
  saving,
  onSwitchView,
}: {
  store: SpreadsheetStore;
  saving: ViewPersistenceBinding;
  onSwitchView: (id: string) => Promise<void>;
}) {
  const saveState = useSyncExternalStore(saving.subscribe, saving.getSnapshot, saving.getSnapshot);
  const scrollRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLInputElement>(null);
  const sheet = useSpreadsheet({ store, scrollRef, columnWidth });
  const { state } = sheet;
  const [jump, setJump] = useState('A1');
  const selected = state.active;
  useEffect(() => {
    setJump(store.rows ? store.labelAddress(selected) : '');
  }, [selected.row, selected.col, state.viewRevision, state.revision, store]);
  useEffect(() => {
    if (state.editing && state.editor === 'cell') editorRef.current?.focus();
  }, [state.editing, state.editor]);
  useEffect(() => {
    const flush = () => {
      void saving.flush();
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (saving.getSnapshot().status !== 'saved' || store.getSnapshot().editing) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    document.addEventListener('visibilitychange', flush);
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', flush);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [saving, store]);
  const act = (promise: Promise<unknown>) => {
    void promise.catch((error) => store.setError(error));
  };
  const isRemote = store.source.mode === 'remote';
  return (
    <section className="sheet-panel" aria-label="Sales workbook">
      <div className="sheet-toolbar">
        <div className="sheet-title">
          <span className="sheet-icon">▦</span>
          <strong>{store.view?.getSnapshot().name ?? 'October sales'}</strong>
          <span className="badge">{isRemote ? 'LIVE DATA' : 'WORKBOOK'}</span>
        </div>
        <div className="toolbar-actions">
          <button
            aria-label="Undo"
            title="Undo (Ctrl/⌘ Z)"
            disabled={!state.canUndo || state.pending}
            onClick={() =>
              act(
                sheet.commitEdit().then(async (ok) => {
                  if (ok) await store.undo();
                }),
              )
            }
          >
            ↶
          </button>
          <button
            aria-label="Redo"
            title="Redo (Ctrl/⌘ Shift Z)"
            disabled={!state.canRedo || state.pending}
            onClick={() =>
              act(
                sheet.commitEdit().then(async (ok) => {
                  if (ok) await store.redo();
                }),
              )
            }
          >
            ↷
          </button>
          <span className="toolbar-separator" />
          <button
            className="calculation-button"
            disabled={!store.rows || state.querying}
            onClick={() =>
              act(
                (async () => {
                  if (!(await sheet.commitEdit())) return;
                  // Start next to the current column so the new calculation is immediately visible.
                  const col = selected.col + 1;
                  store.changeView({
                    type: 'insert',
                    axis: 'columns',
                    before: col,
                    label: 'Calculation',
                  });
                  const units = store.view!.columns.logicalIndex(3);
                  const formula = `=SUM($${columnLabel(units)}$1:$${columnLabel(units)}$${store.view!.rows.logicalCount})`;
                  const address = { row: 0, col };
                  sheet.select(address);
                  await store.ensureRange({ start: address, end: address });
                  sheet.startEdit(formula, address);
                })(),
              )
            }
          >
            ƒx <span>Add calculation</span>
          </button>
        </div>
      </div>
      <FeatureControls store={store} sheet={sheet} saving={saving} onSwitchView={onSwitchView} />
      <div className="formula-bar">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const address = store.resolveAddress(jump);
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
          {...sheet.formulaBarProps}
          placeholder={
            isRemote
              ? 'Select a calculated column to write a formula'
              : 'Select a cell or write a formula, e.g. =SUM(D1:D100000)'
          }
          spellCheck={false}
        />
        {isRemote &&
          store.rows > 0 &&
          store.view?.columns.isOwned(selected.col) &&
          !store.view.rows.isOwned(selected.row) && (
            <span className="formula-hint">
              Applies to column {columnLabel(store.logicalAddress(selected).col)}
            </span>
          )}
      </div>
      {state.editing && sheet.draft.startsWith('=') && (
        <div className="formula-assist" onPointerDown={(e) => e.preventDefault()}>
          {sheet.formula.suggestions.length > 0 && (
            <div role="listbox" aria-label="Formula functions">
              {sheet.formula.suggestions.map((item, i) => (
                <button
                  key={item.name}
                  role="option"
                  aria-selected={i === sheet.formula.selected}
                  onClick={() => sheet.formula.accept(i)}
                >
                  <strong>{item.name}</strong> {item.description}
                </button>
              ))}
            </div>
          )}
          {sheet.formula.help && (
            <span>
              {sheet.formula.help.signature} · argument {sheet.formula.help.argument}
            </span>
          )}
          {sheet.formula.references.map((ref, i) => (
            <span key={i} style={{ color: ref.color }}>
              {ref.label}
            </span>
          ))}
          <small>
            Type a function, or click and drag cells after an operator to insert a reference.
          </small>
        </div>
      )}
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
              <button
                aria-label="Select all cells"
                onClick={() => {
                  void sheet.commitEdit().then((ok) => {
                    if (ok) store.selectAll();
                  });
                }}
              >
                ◩
              </button>
            </div>
            {sheet.virtualColumns.map((col) => (
              <div
                {...sheet.gestures.headerProps('columns', col.index)}
                role="columnheader"
                aria-colindex={col.index + 1}
                key={col.key}
                className={`column-header ${store.view?.columns.isOwned(col.index) ? 'formula-column' : ''}`}
                data-column-id={store.source.columnId(col.index)}
                style={{
                  left: sheet.displayColumn(col.index, col.start),
                  width: col.size,
                  zIndex: col.index < sheet.frozenColumns ? 2 : undefined,
                  background: col.index < sheet.frozenColumns ? '#edf2e8' : undefined,
                }}
              >
                <button
                  className="column-letter drag-handle"
                  {...sheet.gestures.dragProps('columns', col.index)}
                >
                  {columnLabel(store.logicalAddress({ row: 0, col: col.index }).col)}
                </button>
                <span className="column-name">
                  {store.view?.getSnapshot().columns.owned[
                    store.view.columns.canonicalAt(col.index)
                  ]?.label ??
                    SALES_COLUMNS[store.view?.columns.canonicalAt(col.index) ?? col.index] ??
                    'Calculation'}
                </span>
                <button
                  className="header-menu-button"
                  aria-haspopup="dialog"
                  aria-label={`Column ${columnLabel(store.logicalAddress({ row: 0, col: col.index }).col)} menu`}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    void sheet.gestures.openMenu('columns', col.index, rect.left, rect.bottom);
                  }}
                >
                  ⌄
                </button>
                <span
                  className="column-resizer"
                  {...sheet.gestures.resizeProps('columns', col.index)}
                />
              </div>
            ))}
          </div>
          {sheet.virtualRows.map((row) => (
            <div
              role="row"
              aria-rowindex={row.index + 1}
              key={row.key}
              className="grid-row"
              style={{
                top: sheet.displayRow(row.index, row.start),
                width: sheet.totalWidth,
                height: row.size,
                zIndex: row.index < sheet.frozenRows ? 4 : undefined,
              }}
            >
              <div
                {...sheet.gestures.headerProps('rows', row.index)}
                role="rowheader"
                data-row-id={store.source.rowId(row.index)}
                className={`row-header ${selected.row === row.index ? 'selected' : ''}`}
              >
                <button
                  className="row-drag-handle"
                  {...sheet.gestures.dragProps('rows', row.index)}
                >
                  {number.format(store.logicalAddress({ row: row.index, col: 0 }).row + 1)}
                </button>
                <button
                  className="row-menu-button"
                  aria-haspopup="dialog"
                  aria-label={`Row ${store.logicalAddress({ row: row.index, col: 0 }).row + 1} menu`}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    void sheet.gestures.openMenu('rows', row.index, rect.right, rect.top);
                  }}
                >
                  ⋮
                </button>
                <span className="row-resizer" {...sheet.gestures.resizeProps('rows', row.index)} />
              </div>
              {sheet.virtualColumns.map((col) => (
                <Cell
                  key={col.key}
                  store={store}
                  row={row.index}
                  col={col.index}
                  props={sheet.getCellProps({ row: row.index, col: col.index })}
                  left={sheet.displayColumn(col.index, col.start)}
                  frozen={col.index < sheet.frozenColumns}
                  toggle={async (row, col, value) => {
                    if (await sheet.commitEdit()) {
                      await store.ensureRange({ start: { row, col }, end: { row, col } });
                      await store.edit([{ row, col, input: value }]);
                      store.select({ row, col });
                    }
                  }}
                  handle={
                    !state.editing &&
                    state.selectionKind === 'cells' &&
                    row.index === sheet.selection.end.row &&
                    col.index === sheet.selection.end.col
                      ? sheet.fillHandleProps
                      : undefined
                  }
                  width={col.size}
                  active={selected.row === row.index && selected.col === col.index}
                />
              ))}
            </div>
          ))}
          {state.editing && state.editor === 'cell' && (
            <input
              {...sheet.editorProps}
              type={store.columnOptions(state.editing.col)?.kind === 'date' ? 'date' : 'text'}
              list={
                store.columnOptions(state.editing.col)?.kind === 'select'
                  ? 'cell-choices'
                  : undefined
              }
              ref={editorRef}
              className="cell-editor"
              style={sheet.cellRect(state.editing)}
              spellCheck={false}
            />
          )}
          {state.editing && store.columnOptions(state.editing.col)?.kind === 'select' && (
            <datalist id="cell-choices">
              {store.columnOptions(state.editing.col)?.options?.map((option) => (
                <option key={option} value={option} />
              ))}
            </datalist>
          )}
        </div>
        {(state.querying || !store.rows) && (
          <div className="grid-message" role="status">
            {state.querying
              ? 'Searching and sorting every row…'
              : 'No matching rows. Clear or adjust your filters.'}
          </div>
        )}
      </div>
      <div className="selection-summary" aria-live="polite">
        {sheet.summary.loading ? (
          'Calculating selection…'
        ) : sheet.summary.error ? (
          'Selection summary unavailable'
        ) : sheet.summary.value ? (
          <>
            <span>
              Count <strong>{number.format(sheet.summary.value.count)}</strong>
            </span>
            <span>
              Sum <strong>{number.format(sheet.summary.value.sum)}</strong>
            </span>
            <span>
              Average{' '}
              <strong>
                {sheet.summary.value.average === null
                  ? '—'
                  : number.format(sheet.summary.value.average)}
              </strong>
            </span>
            <span>
              Min{' '}
              <strong>
                {sheet.summary.value.min === null ? '—' : number.format(sheet.summary.value.min)}
              </strong>
            </span>
            <span>
              Max{' '}
              <strong>
                {sheet.summary.value.max === null ? '—' : number.format(sheet.summary.value.max)}
              </strong>
            </span>
          </>
        ) : null}
      </div>
      <ViewControls sheet={sheet} store={store} />
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
        <span className="revision" role="status">
          {saveState.status === 'saved'
            ? 'View saved'
            : saveState.status === 'saving'
              ? 'Saving view…'
              : saveState.status === 'error'
                ? 'View not saved'
                : 'Unsaved view'}{' '}
          {saveState.status === 'error' && (
            <button onClick={() => act(saving.flush())} title={saveState.error ?? ''}>
              Retry save
            </button>
          )}
        </span>
      </div>
    </section>
  );
}
