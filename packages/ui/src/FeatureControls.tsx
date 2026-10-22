import { lazy, Suspense, useRef, useState, memo } from 'react';
import type { SpreadsheetStore, SheetViewState } from '@sheet/core';
import type { useSpreadsheet } from '@sheet/react';
import type { SpreadsheetPersistence, SpreadsheetProps } from './types';
import { Button } from './components/button';
const FeatureDialog = lazy(() => import('./FeatureDialog'));
type Sheet = ReturnType<typeof useSpreadsheet>;
export const FeatureControls = memo(function FeatureControls({
  store,
  commitEdit,
  view,
  saving,
  views,
  onSwitchView,
}: {
  store: SpreadsheetStore;
  commitEdit: Sheet['commitEdit'];
  view: SheetViewState | undefined;
  saving?: SpreadsheetPersistence;
  views?: SpreadsheetProps['views'];
  onSwitchView?: (id: string) => Promise<void>;
}) {
  const [panel, setPanel] = useState<'query' | 'format' | 'views' | 'freeze' | 'paste' | null>(
    null,
  );
  const trigger = useRef<HTMLButtonElement | null>(null);
  const close = () => setPanel(null);
  const keys = (['query', 'format', 'freeze', 'paste', 'views'] as const).filter(
    (key) =>
      key === 'paste' || (view && (key !== 'views' || (saving && views?.list && onSwitchView))),
  );
  return (
    <>
      <div className="feature-actions">
        {keys.map((key) => (
          <Button
            variant="outline"
            key={key}
            aria-haspopup="dialog"
            onClick={(event) => {
              trigger.current = event.currentTarget;
              void commitEdit(undefined, false, false).then((ok) => {
                if (ok) setPanel(key);
              });
            }}
          >
            {key === 'query'
              ? 'Sort & filter'
              : key === 'format'
                ? 'Format'
                : key === 'freeze'
                  ? 'Freeze'
                  : key === 'paste'
                    ? 'Paste special'
                    : (view?.name ?? 'Views')}
            {key === 'query' &&
            (view?.query?.sorts?.length || view?.query?.filters?.length || view?.query?.search)
              ? ' •'
              : ''}
          </Button>
        ))}
      </div>
      {panel && (
        <Suspense
          fallback={
            <span className="sr-only" role="status">
              Opening settings…
            </span>
          }
        >
          <FeatureDialog
            panel={panel}
            store={store}
            saving={saving}
            views={views}
            onSwitchView={onSwitchView}
            close={close}
            trigger={trigger}
          />
        </Suspense>
      )}
    </>
  );
});
