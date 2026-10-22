import { useEffect, useState } from 'react';
import {
  Address,
  CanonicalCol,
  CellRange,
  ColIndex,
  columnLabel,
  createSpreadsheet,
  createViewState,
  errorMessage,
  invariant,
  Revision,
  ViewId,
  type SheetViewState,
  type SpreadsheetStore,
  type ViewCapableSource,
} from '@sheet/core';
import { Spreadsheet, Button, type SpreadsheetController } from '@sheet/ui';
import {
  createHttpSource,
  createLocalSource,
  WorkerCalculationAdapter,
  LocalStorageViewAdapter,
  ViewPersistenceBinding,
} from '@sheet/transport';
import { SALES_COLUMNS, SALES_FORMULAS } from '../../shared/sales';

type Mode = 'local' | 'remote';
type ActiveViews = Readonly<Record<Mode, ViewId>>;
/** A store and the binding that autosaves its view; created and disposed together. */
interface LoadedSheet {
  readonly store: SpreadsheetStore;
  readonly persistence: ViewPersistenceBinding;
}

const DEFAULT_VIEW_NAME = 'October sales';
/** Canonical column of units sold, summed by a new calculation. */
const UNITS = CanonicalCol.of(3);
const widths = [154, 130, 204, 94, 128, 112, 150, 138];
const columnWidth = (col: CanonicalCol) => widths[col] ?? 132;
const getColumnLabel = (col: CanonicalCol) => SALES_COLUMNS[col] ?? 'Calculation';
const viewAdapter = new LocalStorageViewAdapter(localStorage);
declare global {
  interface Window {
    __sheet?: SpreadsheetStore;
  }
}

function initialViews(): ActiveViews {
  return {
    local: ViewId.unsafe(localStorage.getItem('ledger:active:local') ?? 'sales-local-v1'),
    remote: ViewId.unsafe(localStorage.getItem('ledger:active:remote') ?? 'sales-remote-v1'),
  };
}

async function openSource(mode: Mode, signal: AbortSignal): Promise<ViewCapableSource> {
  return mode === 'local'
    ? createLocalSource({
        metadata: { rows: 100000, columns: 50, revision: Revision.initial },
        columnFormulas: SALES_FORMULAS,
        calculator: new WorkerCalculationAdapter(
          new Worker(new URL('./calculation.worker.ts', import.meta.url), { type: 'module' }),
        ),
      })
    : createHttpSource({ baseUrl: '/api', signal });
}

function defaultView(source: ViewCapableSource, mode: Mode, viewId: ViewId): SheetViewState {
  return {
    ...createViewState(source, {
      viewId,
      sourceId: `sales-${mode}`,
      ownedColumns: Array.from({ length: 44 }, (_, i) => i + 6),
      labels: Object.fromEntries(SALES_COLUMNS.map((name, index) => [index, name])),
    }),
    name: DEFAULT_VIEW_NAME,
    columnOptions: {
      1: { kind: 'date' },
      3: { kind: 'number', decimals: 0 },
      4: { kind: 'currency', currency: 'EUR' },
      5: { kind: 'percent' },
      6: { kind: 'currency', currency: 'EUR' },
      7: { kind: 'currency', currency: 'EUR' },
    },
  };
}

async function loadSheet(mode: Mode, viewId: ViewId, signal: AbortSignal): Promise<LoadedSheet> {
  const source = await openSource(mode, signal);
  try {
    const saved = await viewAdapter.load(viewId, signal);
    signal.throwIfAborted();
    const store = createSpreadsheet({
      source,
      view: { state: saved?.state ?? defaultView(source, mode, viewId) },
    });
    const view = store.view;
    invariant(view, 'a store created with a view exposes it');
    const persistence = new ViewPersistenceBinding(view, viewAdapter, saved?.version ?? null);
    // Older saved views have no name; naming them goes through autosave.
    if (saved && !saved.state.name) view.replace({ ...saved.state, name: DEFAULT_VIEW_NAME });
    return { store, persistence };
  } catch (error) {
    source.dispose();
    throw error;
  }
}

/** Writes a pending cell edit before the store is replaced. */
async function commitPending(store: SpreadsheetStore): Promise<void> {
  if (store.getSnapshot().editing) await store.commitDraft();
}

/** Inserts a calculated column after the active one and starts a formula summing units. */
async function addCalculation(store: SpreadsheetStore, sheet: SpreadsheetController) {
  if (!(await sheet.edit.commit())) return;
  const view = store.view;
  if (!view) return;
  // Start next to the current column so the new calculation is immediately visible.
  const col = ColIndex.offset(sheet.state.active.col, 1);
  store.changeView({ type: 'insert', axis: 'columns', before: col, label: 'Calculation' });
  const units = view.columns.logicalIndex(UNITS);
  invariant(units !== undefined, 'the units column belongs to the source');
  const letter = columnLabel(units);
  const address = Address.of(0, col);
  sheet.navigation.select(address);
  await store.ensureRange(CellRange.of(address));
  sheet.edit.start({
    initial: `=SUM($${letter}$1:$${letter}$${view.rows.logicalCount})`,
    address,
  });
}

export function App() {
  const [activeViews, setActiveViews] = useState<ActiveViews>(initialViews);
  const [mode, setMode] = useState<Mode>('local');
  const [sheet, setSheet] = useState<LoadedSheet | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let loaded: LoadedSheet | undefined;
    const controller = new AbortController();
    setSheet(null);
    setError('');
    loadSheet(mode, activeViews[mode], controller.signal)
      .then((result) => {
        if (controller.signal.aborted) {
          result.persistence.dispose();
          result.store.dispose();
          return;
        }
        loaded = result;
        setSheet(result);
        if (import.meta.env.DEV) window.__sheet = result.store;
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(cause));
      });
    return () => {
      controller.abort();
      loaded?.persistence.dispose();
      loaded?.store.dispose();
      if (loaded && window.__sheet === loaded.store) delete window.__sheet;
    };
  }, [mode, attempt, activeViews]);
  async function switchMode(next: Mode) {
    try {
      if (sheet) {
        await commitPending(sheet.store);
        await sheet.persistence.flush();
      }
      if (sheet?.persistence.getSnapshot().status !== 'error') setMode(next);
    } catch (cause) {
      sheet?.store.setError(cause);
    }
  }
  async function switchView(id: ViewId) {
    try {
      if (sheet) {
        await commitPending(sheet.store);
        await sheet.persistence.flush();
        const status = sheet.persistence.getSnapshot();
        if (status.status === 'error') throw new Error(status.error);
      }
      localStorage.setItem(`ledger:active:${mode}`, id);
      setActiveViews((previous) => ({ ...previous, [mode]: id }));
    } catch (cause) {
      sheet?.store.setError(cause);
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
            <Button
              variant="ghost"
              className={mode === 'local' ? 'selected' : ''}
              onClick={() => {
                void switchMode('local');
              }}
            >
              Local workbook
            </Button>
            <Button
              variant="ghost"
              className={mode === 'remote' ? 'selected' : ''}
              onClick={() => {
                void switchMode('remote');
              }}
            >
              Live server <span className="small-dot" />
            </Button>
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
        {sheet ? (
          <Spreadsheet
            key={mode + attempt + activeViews[mode]}
            store={sheet.store}
            persistence={sheet.persistence}
            views={viewAdapter}
            height="clamp(320px, calc(100vh - 470px), 660px)"
            getColumnLabel={getColumnLabel}
            columnWidth={columnWidth}
            renderToolbar={(controller) => (
              <Button
                variant="outline"
                aria-label="Add calculation"
                className="calculation-button"
                disabled={!sheet.store.rows || controller.state.querying}
                onClick={() => {
                  addCalculation(sheet.store, controller).catch((cause: unknown) =>
                    sheet.store.setError(cause),
                  );
                }}
              >
                ƒx <span>Add calculation</span>
              </Button>
            )}
            onSwitchView={switchView}
          />
        ) : (
          <div className="loading-panel">
            {error ? (
              <>
                <strong>Could not connect</strong>
                <p>{error}</p>
                <Button variant="ghost" onClick={() => setAttempt((value) => value + 1)}>
                  Try again
                </Button>
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
