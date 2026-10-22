import { useEffect, useState, useContext, type RefObject } from 'react';
import { PastePanel } from './PastePanel';
import {
  columnLabel,
  type CellKind,
  type ColumnFilter,
  type ConditionalRule,
  type SpreadsheetStore,
  type ViewQuery,
  type ViewSummary,
} from '@sheet/core';
import type { SpreadsheetPersistence, SpreadsheetProps } from './types';
import { SheetContext } from './context';
import { Button } from './components/button';
import { Input } from './components/input';
import { Textarea } from './components/textarea';
import { NativeSelect } from './components/native-select';
import { Dialog, DialogContent, DialogTitle } from './components/dialog';

const operators: ColumnFilter['operator'][] = [
  'contains',
  'equals',
  'gt',
  'gte',
  'lt',
  'lte',
  'empty',
  'notEmpty',
];
const operatorLabels = {
  contains: 'Contains',
  equals: 'Equals',
  gt: 'Greater than',
  gte: 'At least',
  lt: 'Less than',
  lte: 'At most',
  empty: 'Is empty',
  notEmpty: 'Is not empty',
};
export default function FeatureDialog({
  panel,
  store,
  saving,
  views,
  onSwitchView,
  close,
  trigger,
}: {
  panel: 'query' | 'format' | 'views' | 'freeze' | 'paste';
  store: SpreadsheetStore;
  saving?: SpreadsheetPersistence;
  views?: SpreadsheetProps['views'];
  onSwitchView?: (id: string) => Promise<void>;
  close: () => void;
  trigger: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <Dialog
      open={!!panel}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      {panel && (
        <DialogContent className="feature-dialog" showCloseButton={false} finalFocus={trigger}>
          <div className="feature-content">
            <div className="feature-heading">
              <DialogTitle>
                {panel === 'query'
                  ? 'Sort, filter & search'
                  : panel === 'format'
                    ? 'Column format'
                    : panel === 'freeze'
                      ? 'Freeze panes'
                      : panel === 'paste'
                        ? 'Paste special'
                        : 'Saved views'}
              </DialogTitle>
              <Button variant="outline" aria-label="Close settings" onClick={close}>
                ×
              </Button>
            </div>
            {panel === 'query' ? (
              <QueryPanel store={store} close={close} />
            ) : panel === 'format' ? (
              <FormatPanel store={store} close={close} />
            ) : panel === 'freeze' ? (
              <FreezePanel store={store} close={close} />
            ) : panel === 'paste' ? (
              <PastePanel store={store} close={close} />
            ) : (
              <ViewsPanel
                store={store}
                saving={saving!}
                views={views!}
                onSwitchView={onSwitchView!}
                close={close}
              />
            )}
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}

function columns(store: SpreadsheetStore, getColumnLabel?: (col: number) => string | undefined) {
  return Array.from({ length: store.columns }, (_, i) => {
    const id = store.view!.columns.canonicalAt(i);
    const label = store.view!.getSnapshot().columns.owned[id]?.label ?? getColumnLabel?.(id);
    return {
      id,
      label: `${columnLabel(store.view!.columns.logicalIndex(id))}${label ? ' · ' + label : ''}`,
    };
  });
}
function ColumnSelect({
  store,
  value,
  onChange,
  label,
}: {
  store: SpreadsheetStore;
  value: number;
  onChange: (col: number) => void;
  label: string;
}) {
  const { getColumnLabel } = useContext(SheetContext);
  return (
    <NativeSelect
      aria-label={label}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    >
      {columns(store, getColumnLabel).map((c) => (
        <option key={c.id} value={c.id}>
          {c.label}
        </option>
      ))}
    </NativeSelect>
  );
}
function QueryPanel({ store, close }: { store: SpreadsheetStore; close: () => void }) {
  const [query, setQuery] = useState<ViewQuery>(store.view!.getSnapshot().query ?? {}),
    [error, setError] = useState('');
  const first = store.view!.columns.canonicalAt(store.getSnapshot().active.col);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        try {
          store.configure({ query });
          close();
        } catch (e) {
          setError(String(e));
        }
      }}
    >
      <label className="stack-field">
        Search all visible columns
        <Input
          autoFocus
          type="search"
          maxLength={200}
          value={query.search ?? ''}
          onChange={(e) => setQuery({ ...query, search: e.target.value })}
          placeholder="Find across every row…"
        />
      </label>
      <h3>Sort priority</h3>
      {(query.sorts ?? []).map((sort, i) => (
        <div className="control-row" key={i}>
          <ColumnSelect
            store={store}
            value={sort.col}
            label={`Sort column ${i + 1}`}
            onChange={(col) =>
              setQuery({
                ...query,
                sorts: query.sorts!.map((s, j) => (j === i ? { ...s, col } : s)),
              })
            }
          />
          <NativeSelect
            aria-label={`Sort direction ${i + 1}`}
            value={sort.direction}
            onChange={(e) =>
              setQuery({
                ...query,
                sorts: query.sorts!.map((s, j) =>
                  j === i ? { ...s, direction: e.target.value as 'asc' | 'desc' } : s,
                ),
              })
            }
          >
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </NativeSelect>
          <Button
            variant="outline"
            type="button"
            aria-label={`Remove sort ${i + 1}`}
            onClick={() => setQuery({ ...query, sorts: query.sorts!.filter((_, j) => j !== i) })}
          >
            ×
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        type="button"
        disabled={(query.sorts?.length ?? 0) >= 3}
        onClick={() =>
          setQuery({ ...query, sorts: [...(query.sorts ?? []), { col: first, direction: 'asc' }] })
        }
      >
        + Add sort
      </Button>
      <h3>Filters · match all</h3>
      {(query.filters ?? []).map((filter, i) => (
        <div className="control-row filter-row" key={i}>
          <ColumnSelect
            store={store}
            value={filter.col}
            label={`Filter column ${i + 1}`}
            onChange={(col) =>
              setQuery({
                ...query,
                filters: query.filters!.map((f, j) => (j === i ? { ...f, col } : f)),
              })
            }
          />
          <NativeSelect
            aria-label={`Filter condition ${i + 1}`}
            value={filter.operator}
            onChange={(e) =>
              setQuery({
                ...query,
                filters: query.filters!.map((f, j) =>
                  j === i ? { ...f, operator: e.target.value as ColumnFilter['operator'] } : f,
                ),
              })
            }
          >
            {operators.map((op) => (
              <option key={op} value={op}>
                {operatorLabels[op]}
              </option>
            ))}
          </NativeSelect>
          {!['empty', 'notEmpty'].includes(filter.operator) && (
            <Input
              aria-label={`Filter value ${i + 1}`}
              value={String(filter.value ?? '')}
              onChange={(e) =>
                setQuery({
                  ...query,
                  filters: query.filters!.map((f, j) =>
                    j === i ? { ...f, value: e.target.value } : f,
                  ),
                })
              }
            />
          )}
          <Button
            variant="outline"
            type="button"
            aria-label={`Remove filter ${i + 1}`}
            onClick={() =>
              setQuery({ ...query, filters: query.filters!.filter((_, j) => j !== i) })
            }
          >
            ×
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        type="button"
        disabled={(query.filters?.length ?? 0) >= 8}
        onClick={() =>
          setQuery({
            ...query,
            filters: [...(query.filters ?? []), { col: first, operator: 'contains', value: '' }],
          })
        }
      >
        + Add filter
      </Button>
      <p className="settings-note">
        Applies to the entire dataset. Row labels and formula references keep their original
        identities. Clear the query before moving or inserting rows.
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="dialog-actions">
        <Button
          variant="outline"
          type="button"
          onClick={() => {
            store.configure({ query: {} });
            close();
          }}
        >
          Clear query
        </Button>
        <Button variant="default" type="submit">
          Apply query
        </Button>
      </div>
    </form>
  );
}
function FreezePanel({ store, close }: { store: SpreadsheetStore; close: () => void }) {
  const [frozen, setFrozen] = useState(store.view!.getSnapshot().frozen ?? { rows: 0, columns: 0 });
  const [error, setError] = useState('');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        try {
          store.configure({ frozen });
          close();
        } catch (e) {
          setError(String(e));
        }
      }}
    >
      <p>Keep the first rows and columns visible while scrolling.</p>
      <label className="stack-field">
        Frozen rows
        <Input
          autoFocus
          type="number"
          min={0}
          max={Math.min(store.rows, 20)}
          value={frozen.rows}
          onChange={(e) => setFrozen({ ...frozen, rows: Number(e.target.value) })}
        />
      </label>
      <label className="stack-field">
        Frozen columns
        <Input
          type="number"
          min={0}
          max={Math.min(store.columns, 10)}
          value={frozen.columns}
          onChange={(e) => setFrozen({ ...frozen, columns: Number(e.target.value) })}
        />
      </label>
      <p className="settings-note">
        On small screens, only panes that fit are pinned. The saved setting stays the same.
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="dialog-actions">
        <Button
          variant="outline"
          type="button"
          onClick={() => {
            store.configure({ frozen: { rows: 0, columns: 0 } });
            close();
          }}
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
function FormatPanel({ store, close }: { store: SpreadsheetStore; close: () => void }) {
  const view = store.view!.getSnapshot(),
    col = store.view!.columns.canonicalAt(store.getSnapshot().active.col);
  const [option, setOption] = useState(view.columnOptions?.[col] ?? { kind: 'auto' as CellKind });
  const [rules, setRules] = useState<ConditionalRule[]>(
      view.conditionalRules?.filter((r) => r.col === col) ?? [],
    ),
    [error, setError] = useState('');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        try {
          store.configure({
            columnOptions: { ...view.columnOptions, [col]: option },
            conditionalRules: [
              ...(view.conditionalRules?.filter((r) => r.col !== col) ?? []),
              ...rules,
            ],
          });
          close();
        } catch (e) {
          setError(String(e));
        }
      }}
    >
      <p>Column {columnLabel(store.view!.columns.logicalIndex(col))} · applies to all rows</p>
      <label className="stack-field">
        Cell type
        <NativeSelect
          autoFocus
          value={option.kind}
          onChange={(e) => setOption({ ...option, kind: e.target.value as CellKind })}
        >
          {['auto', 'text', 'number', 'currency', 'percent', 'date', 'checkbox', 'select'].map(
            (kind) => (
              <option key={kind}>{kind}</option>
            ),
          )}
        </NativeSelect>
      </label>
      {['number', 'currency', 'percent'].includes(option.kind) && (
        <label className="stack-field">
          Decimal places
          <Input
            type="number"
            min={0}
            max={10}
            value={option.decimals ?? 2}
            onChange={(e) => setOption({ ...option, decimals: Number(e.target.value) })}
          />
        </label>
      )}
      {option.kind === 'currency' && (
        <label className="stack-field">
          Currency
          <NativeSelect
            value={option.currency ?? 'EUR'}
            onChange={(e) => setOption({ ...option, currency: e.target.value })}
          >
            {['EUR', 'CZK', 'USD', 'GBP'].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </NativeSelect>
        </label>
      )}
      {option.kind === 'select' && (
        <label className="stack-field">
          Choices (one per line)
          <Textarea
            value={option.options?.join('\n') ?? ''}
            onChange={(e) => setOption({ ...option, options: e.target.value.split('\n') })}
          />
        </label>
      )}
      <h3>Conditional formatting</h3>
      {rules.map((rule, i) => (
        <div className="control-row filter-row" key={rule.id}>
          <NativeSelect
            aria-label={`Rule condition ${i + 1}`}
            value={rule.operator}
            onChange={(e) =>
              setRules(
                rules.map((r, j) =>
                  j === i ? { ...r, operator: e.target.value as ColumnFilter['operator'] } : r,
                ),
              )
            }
          >
            {operators.map((op) => (
              <option key={op} value={op}>
                {operatorLabels[op]}
              </option>
            ))}
          </NativeSelect>
          {!['empty', 'notEmpty'].includes(rule.operator) && (
            <Input
              aria-label={`Rule value ${i + 1}`}
              value={String(rule.value ?? '')}
              onChange={(e) =>
                setRules(rules.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)))
              }
            />
          )}
          <Input
            type="color"
            aria-label={`Rule background ${i + 1}`}
            value={rule.background}
            onChange={(e) =>
              setRules(rules.map((r, j) => (j === i ? { ...r, background: e.target.value } : r)))
            }
          />
          <Input
            type="color"
            aria-label={`Rule text color ${i + 1}`}
            value={rule.color}
            onChange={(e) =>
              setRules(rules.map((r, j) => (j === i ? { ...r, color: e.target.value } : r)))
            }
          />
          <Button
            variant="outline"
            type="button"
            aria-label={`Remove rule ${i + 1}`}
            onClick={() => setRules(rules.filter((_, j) => j !== i))}
          >
            ×
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        type="button"
        disabled={rules.length >= 32}
        onClick={() =>
          setRules([
            ...rules,
            {
              id: crypto.randomUUID(),
              col,
              operator: 'lt',
              value: 0,
              color: '#9f1239',
              background: '#ffe4e6',
            },
          ])
        }
      >
        + Add rule
      </Button>
      <p className="settings-note">
        The first matching rule wins. Types validate new inputs; existing values are preserved.
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="dialog-actions">
        <Button variant="default" type="submit">
          Apply format
        </Button>
      </div>
    </form>
  );
}
function ViewsPanel({
  store,
  saving,
  views,
  onSwitchView,
  close,
}: {
  store: SpreadsheetStore;
  saving: SpreadsheetPersistence;
  views: NonNullable<SpreadsheetProps['views']>;
  onSwitchView: (id: string) => Promise<void>;
  close: () => void;
}) {
  const [savedViews, setViews] = useState<ViewSummary[]>([]),
    [name, setName] = useState(store.view!.getSnapshot().name ?? 'Untitled view'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    void saving
      .flush()
      .then(() => views.list!(store.view!.getSnapshot().sourceId, c.signal))
      .then((v) => {
        if (!c.signal.aborted) setViews(v);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(String(e));
      });
    return () => c.abort();
  }, [store, saving, views]);
  const run = (task: () => Promise<void>) => {
    setBusy(true);
    setError('');
    void task()
      .catch((e) => setError(String(e)))
      .finally(() => setBusy(false));
  };
  return (
    <div>
      <label className="stack-field">
        View name
        <Input autoFocus maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="dialog-actions">
        <Button
          variant="outline"
          disabled={busy || !name.trim()}
          onClick={() =>
            run(async () => {
              store.configure({ name: name.trim() });
              await saving.flush();
              if (saving.getSnapshot().status === 'error')
                throw new Error(saving.getSnapshot().error!);
              close();
            })
          }
        >
          Rename current view
        </Button>
        <Button
          variant="default"
          disabled={busy || !name.trim()}
          onClick={() =>
            run(async () => {
              await saving.flush();
              if (saving.getSnapshot().status === 'error')
                throw new Error(saving.getSnapshot().error!);
              const state = {
                ...store.view!.getSnapshot(),
                viewId: crypto.randomUUID(),
                name: name.trim(),
                revision: 0,
              };
              await views.save(state, null, new AbortController().signal);
              close();
              await onSwitchView(state.viewId);
            })
          }
        >
          Save as new view
        </Button>
      </div>
      <h3>Your views</h3>
      <div className="view-list">
        {savedViews.map((view) => (
          <Button
            variant="outline"
            disabled={busy || view.viewId === store.view!.getSnapshot().viewId}
            key={view.viewId}
            onClick={() =>
              run(async () => {
                close();
                await onSwitchView(view.viewId);
              })
            }
          >
            {view?.name}
            {view.viewId === store.view!.getSnapshot().viewId ? ' · current' : ' →'}
          </Button>
        ))}
      </div>
      <p className="settings-note">
        Each view saves its layout, query, formats, frozen panes and calculations.
      </p>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
