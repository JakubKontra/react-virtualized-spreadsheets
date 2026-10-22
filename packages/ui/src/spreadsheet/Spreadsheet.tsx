'use client';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useSpreadsheet } from '@sheet/react';
import { TooltipProvider } from '../components/tooltip';
import { SheetContext, type SheetContextValue } from '../context';
import { FeatureControls } from '../feature-dialog/FeatureControls';
import { isViewCatalog, type SavedViews } from '../feature-dialog/panels';
import { cn } from '../lib/utils';
import type { SpreadsheetProps } from '../types';
import { ViewControls } from '../view-controls/ViewControls';
import { ErrorBanner } from './ErrorBanner';
import { FormulaAssist } from './FormulaAssist';
import { FormulaBar } from './FormulaBar';
import { Grid } from './Grid';
import { useNumberFormat } from './hooks/use-number-format';
import { useSaveStatus, useUnloadGuard } from './hooks/use-save-status';
import { KeyboardHints } from './KeyboardHints';
import { SaveStatus } from './SaveStatus';
import { SelectionSummaryBar } from './SelectionSummaryBar';
import { StatusBar } from './StatusBar';
import { Toolbar } from './Toolbar';

export function Spreadsheet({
  store,
  persistence,
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
  const saveStatus = useSaveStatus(persistence);
  useUnloadGuard(store, persistence);
  const number = useNumberFormat(locale);
  const [portal, setPortal] = useState<HTMLDivElement | null>(null);
  const context = useMemo<SheetContextValue>(
    () => ({ portal, getColumnLabel }),
    [portal, getColumnLabel],
  );
  const saved = useMemo<SavedViews | undefined>(
    () =>
      persistence && views && isViewCatalog(views) && onSwitchView
        ? { persistence, catalog: views, onSwitchView }
        : undefined,
    [persistence, views, onSwitchView],
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLInputElement>(null);
  const formulaBarRef = useRef<HTMLInputElement>(null);
  const assistId = useId();
  const sheet = useSpreadsheet({ store, scrollRef, columnWidth });
  const { state } = sheet;
  const settings = store.view?.getSnapshot();
  const label = title ?? settings?.name ?? 'Spreadsheet';
  const showAssist = state.editing !== null && sheet.edit.draft.startsWith('=');
  useEffect(() => {
    if (state.editing && state.editor === 'cell') editorRef.current?.focus();
  }, [state.editing, state.editor]);
  return (
    <SheetContext.Provider value={context}>
      <TooltipProvider delay={400}>
        <div className={cn('sheet-ui', className)}>
          <section className="sheet-panel" aria-label={label}>
            <Toolbar store={store} sheet={sheet} label={label}>
              {renderToolbar?.(sheet)}
            </Toolbar>
            <FeatureControls
              store={store}
              commit={sheet.edit.commit}
              settings={settings}
              saved={saved}
            />
            <FormulaBar
              store={store}
              sheet={sheet}
              scrollRef={scrollRef}
              inputRef={formulaBarRef}
              assistId={showAssist && state.editor === 'bar' ? assistId : undefined}
            />
            {state.error && <ErrorBanner store={store} error={state.error} />}
            <Grid
              store={store}
              sheet={sheet}
              scrollRef={scrollRef}
              editorRef={editorRef}
              height={height}
              locale={locale}
              number={number}
              assistId={showAssist ? assistId : undefined}
            />
            {showAssist && (
              <FormulaAssist
                id={assistId}
                sheet={sheet}
                anchorRef={state.editor === 'cell' ? editorRef : formulaBarRef}
                scrollRef={scrollRef}
              />
            )}
            <SelectionSummaryBar summary={sheet.summary} number={number} />
            <ViewControls sheet={sheet} store={store} scrollRef={scrollRef} />
            <StatusBar store={store} state={state} label={label} number={number} />
            <KeyboardHints>
              {persistence && saveStatus && (
                <SaveStatus store={store} persistence={persistence} status={saveStatus} />
              )}
            </KeyboardHints>
          </section>
          <div ref={setPortal} className="sheet-portals" />
        </div>
      </TooltipProvider>
    </SheetContext.Provider>
  );
}
