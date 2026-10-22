'use client';
import {
  memo,
  useEffect,
  useLayoutEffect,
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type HTMLAttributes,
} from 'react';
import {
  columnLabel,
  isError,
  formatCellValue,
  matchesFilter,
  type SpreadsheetStore,
} from '@sheet/core';
import { useCell, useSpreadsheet } from '@sheet/react';
import { Table2 } from 'lucide-react';
import { Separator } from './components/separator';
import { TooltipProvider } from './components/tooltip';
import { HistoryActions } from './HistoryActions';
import { SheetContext } from './context';
import { cn } from './lib/utils';
import type { SpreadsheetProps } from './types';
import { ViewControls } from './ViewControls';
import { FeatureControls } from './FeatureControls';
import { FormulaAssist } from './FormulaAssist';
const noSubscribe = () => () => {};
const noSnapshot = () => null;
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
  locale,
}: {
  store: SpreadsheetStore;
  locale: string;
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
  const text = formatCellValue(cell.value, option, locale);
  const rule = store.view
    ?.getSnapshot()
    .conditionalRules?.find((r) => r.col === canonicalCol && matchesFilter(cell.value, r));
  return (
    <div
      {...props}
      className={`cell ${typeof cell.value === 'number' ? 'numeric' : ''} ${store.view?.columns.isOwned(col) ? 'computed' : ''} ${active ? 'current' : ''} ${frozen ? 'frozen-cell' : ''} ${cell.status === 'error' ? 'cell-error' : ''} ${cell.status === 'calculating' ? 'calculating' : ''}`}
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
export function Spreadsheet({
  store,
  persistence: saving,
  views,
  onSwitchView,
  title,
  height = 480,
  locale = 'en-US',
  className,
  getColumnLabel,
  columnWidth,
  renderToolbar,
}: SpreadsheetProps) {
  const saveState = useSyncExternalStore(
    saving?.subscribe ?? noSubscribe,
    saving?.getSnapshot ?? noSnapshot,
    saving?.getSnapshot ?? noSnapshot,
  );
  const number = useMemo(
    () => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }),
    [locale],
  );
  const [portal, setPortal] = useState<HTMLDivElement | null>(null);
  const context = useMemo(() => ({ portal, getColumnLabel }), [portal, getColumnLabel]);
  const choicesId = useId();
  const label = title ?? store.view?.getSnapshot().name ?? 'Spreadsheet';
  const scrollRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLInputElement>(null);
  const formulaBarRef = useRef<HTMLInputElement>(null);
  const formulaAssistId = useId();
  const sheet = useSpreadsheet({ store, scrollRef, columnWidth });
  const { state } = sheet;
  // Toolbar controls should not rerender on virtualizer scroll frames, but actions
  // must always use the latest committed controller (including frozen/query geometry).
  const commitRef = useRef(sheet.commitEdit);
  useLayoutEffect(() => {
    commitRef.current = sheet.commitEdit;
  });
  const commitEdit = useCallback<typeof sheet.commitEdit>(
    (...args) => commitRef.current(...args),
    [],
  );
  const showFormulaAssist = !!state.editing && sheet.draft.startsWith('=');
  const [jump, setJump] = useState('A1');
  const selected = state.active;
  useEffect(() => {
    setJump(store.rows ? store.labelAddress(selected) : '');
  }, [selected.row, selected.col, state.viewRevision, state.revision, store]);
  useEffect(() => {
    if (state.editing && state.editor === 'cell') editorRef.current?.focus();
  }, [state.editing, state.editor]);
  useEffect(() => {
    if (!saving) return;
    const flush = () => {
      void saving.flush().catch((error) => store.setError(error));
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
    <SheetContext.Provider value={context}>
      <TooltipProvider delay={400}>
        <div className={cn('sheet-ui', className)}>
          <section className="sheet-panel" aria-label={label}>
            <div className="sheet-toolbar">
              <div className="sheet-title">
                <Table2 size={18} aria-hidden="true" />
                <strong>{label}</strong>
                <span className="badge">{isRemote ? 'LIVE DATA' : 'WORKBOOK'}</span>
              </div>
              <div className="toolbar-actions">
                <HistoryActions
                  store={store}
                  commitEdit={commitEdit}
                  canUndo={state.canUndo}
                  canRedo={state.canRedo}
                  pending={state.pending}
                />
                <Separator orientation="vertical" className="h-5 mx-1" />
                {renderToolbar?.(sheet)}
              </div>
            </div>
            <FeatureControls
              store={store}
              commitEdit={commitEdit}
              view={store.view?.getSnapshot()}
              saving={saving}
              views={views}
              onSwitchView={onSwitchView}
            />
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
                ref={formulaBarRef}
                aria-describedby={
                  showFormulaAssist && state.editor === 'bar' ? formulaAssistId : undefined
                }
                placeholder={
                  isRemote
                    ? 'Select a calculated column to write a formula'
                    : 'Select a cell or write a formula, e.g. =SUM(A1:A10)'
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
            <div
              {...sheet.gridProps}
              ref={scrollRef}
              className="grid-scroll"
              data-testid="grid"
              style={{ height }}
            >
              <div
                className="grid-canvas"
                style={{ width: sheet.totalWidth, height: sheet.totalHeight }}
              >
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
                        background:
                          col.index < sheet.frozenColumns ? 'var(--sheet-muted)' : undefined,
                      }}
                    >
                      <button
                        className="column-letter drag-handle"
                        {...(store.view
                          ? sheet.gestures.dragProps('columns', col.index)
                          : {
                              'aria-label': `Select column ${col.index + 1}`,
                              onClick: () => {
                                void sheet.commitEdit().then((ok) => {
                                  if (ok) store.selectAxis('columns', col.index);
                                });
                              },
                            })}
                      >
                        {columnLabel(store.logicalAddress({ row: 0, col: col.index }).col)}
                      </button>
                      <span className="column-name">
                        {store.view?.getSnapshot().columns.owned[
                          store.view.columns.canonicalAt(col.index)
                        ]?.label ??
                          getColumnLabel?.(
                            store.view?.columns.canonicalAt(col.index) ?? col.index,
                          ) ??
                          ''}
                      </span>
                      {store.view && (
                        <button
                          className="header-menu-button"
                          aria-haspopup="dialog"
                          aria-label={`Column ${columnLabel(store.logicalAddress({ row: 0, col: col.index }).col)} menu`}
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            const rect = event.currentTarget.getBoundingClientRect();
                            void sheet.gestures.openMenu(
                              'columns',
                              col.index,
                              rect.left,
                              rect.bottom,
                            );
                          }}
                        >
                          ⌄
                        </button>
                      )}
                      {store.view && (
                        <span
                          className="column-resizer"
                          {...sheet.gestures.resizeProps('columns', col.index)}
                        />
                      )}
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
                        {...(store.view
                          ? sheet.gestures.dragProps('rows', row.index)
                          : {
                              'aria-label': `Select row ${row.index + 1}`,
                              onClick: () => {
                                void sheet.commitEdit().then((ok) => {
                                  if (ok) store.selectAxis('rows', row.index);
                                });
                              },
                            })}
                      >
                        {number.format(store.logicalAddress({ row: row.index, col: 0 }).row + 1)}
                      </button>
                      {store.view && (
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
                      )}
                      {store.view && (
                        <span
                          className="row-resizer"
                          {...sheet.gestures.resizeProps('rows', row.index)}
                        />
                      )}
                    </div>
                    {sheet.virtualColumns.map((col) => (
                      <Cell
                        key={col.key}
                        store={store}
                        locale={locale}
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
                    aria-describedby={showFormulaAssist ? formulaAssistId : undefined}
                    type={store.columnOptions(state.editing.col)?.kind === 'date' ? 'date' : 'text'}
                    list={
                      store.columnOptions(state.editing.col)?.kind === 'select'
                        ? choicesId
                        : undefined
                    }
                    ref={editorRef}
                    className="cell-editor"
                    style={sheet.cellRect(state.editing)}
                    spellCheck={false}
                  />
                )}
                {state.editing && store.columnOptions(state.editing.col)?.kind === 'select' && (
                  <datalist id={choicesId}>
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
            {showFormulaAssist && (
              <FormulaAssist
                id={formulaAssistId}
                sheet={sheet}
                anchorRef={state.editor === 'cell' ? editorRef : formulaBarRef}
                scrollRef={scrollRef}
              />
            )}
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
                      {sheet.summary.value.min === null
                        ? '—'
                        : number.format(sheet.summary.value.min)}
                    </strong>
                  </span>
                  <span>
                    Max{' '}
                    <strong>
                      {sheet.summary.value.max === null
                        ? '—'
                        : number.format(sheet.summary.value.max)}
                    </strong>
                  </span>
                </>
              ) : null}
            </div>
            <ViewControls sheet={sheet} store={store} scrollRef={scrollRef} />
            <div className="sheet-bottom">
              <div className="sheet-tab">
                <Table2 size={14} aria-hidden="true" /> {label}
              </div>
              <div className="sheet-status" aria-live="polite">
                <span
                  className={`status-dot ${state.connection === 'disconnected' ? 'offline' : ''}`}
                />
                {state.connection === 'disconnected'
                  ? 'Disconnected · showing last values'
                  : state.pending
                    ? 'Saving changes…'
                    : state.loading
                      ? 'Calculating…'
                      : isRemote
                        ? 'Live connection'
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
              {saveState && saving && (
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
              )}
            </div>
          </section>
          <div ref={setPortal} className="sheet-portals" />
        </div>
      </TooltipProvider>
    </SheetContext.Provider>
  );
}
