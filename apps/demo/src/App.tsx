import { useEffect, useState } from 'react';
import {
  columnLabel,
  createSpreadsheet,
  createViewState,
  type SpreadsheetStore,
} from '@sheet/core';
import { Spreadsheet, Button } from '@sheet/ui';
import {
  createHttpSource,
  createLocalSource,
  WorkerCalculationAdapter,
  LocalStorageViewAdapter,
  ViewPersistenceBinding,
} from '@sheet/transport';
import { SALES_COLUMNS, SALES_FORMULAS } from '../../shared/sales';

const widths = [154, 130, 204, 94, 128, 112, 150, 138];
const columnWidth = (col: number) => widths[col] ?? 132;
const viewAdapter = new LocalStorageViewAdapter(localStorage);
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
      const adapter = viewAdapter;
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
        {store ? (
          <Spreadsheet
            key={mode + attempt + activeViews[mode]}
            store={store}
            persistence={saving!}
            views={viewAdapter}
            height="clamp(320px, calc(100vh - 470px), 660px)"
            getColumnLabel={(col) => SALES_COLUMNS[col] ?? 'Calculation'}
            columnWidth={columnWidth}
            renderToolbar={(sheet) => (
              <Button
                variant="outline"
                aria-label="Add calculation"
                className="calculation-button"
                disabled={!store.rows || sheet.state.querying}
                onClick={() =>
                  void (async () => {
                    if (!(await sheet.commitEdit())) return;
                    // Start next to the current column so the new calculation is immediately visible.
                    const col = sheet.state.active.col + 1;
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
                  })().catch((error) => store.setError(error))
                }
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
