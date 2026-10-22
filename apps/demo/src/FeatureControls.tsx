import { useEffect, useRef, useState } from 'react';
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
import type { useSpreadsheet } from '@sheet/react';
import { LocalStorageViewAdapter, type ViewPersistenceBinding } from '@sheet/transport';

type Sheet = ReturnType<typeof useSpreadsheet>;
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
export function FeatureControls({
  store,
  sheet,
  saving,
  onSwitchView,
}: {
  store: SpreadsheetStore;
  sheet: Sheet;
  saving: ViewPersistenceBinding;
  onSwitchView: (id: string) => Promise<void>;
}) {
  const [panel, setPanel] = useState<'query' | 'format' | 'views' | 'freeze' | 'paste' | null>(
    null,
  );
  const ref = useRef<HTMLDialogElement>(null),
    trigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (panel) ref.current?.showModal();
  }, [panel]);
  const close = () => {
    ref.current?.close();
    setPanel(null);
    trigger.current?.focus();
  };
  const view = store.view!.getSnapshot();
  return (
    <>
      <div className="feature-actions">
        {(['query', 'format', 'freeze', 'paste', 'views'] as const).map((key) => (
          <button
            key={key}
            aria-haspopup="dialog"
            onClick={(event) => {
              trigger.current = event.currentTarget;
              void sheet.commitEdit(undefined, false, false).then((ok) => {
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
                    : (view.name ?? 'Views')}
            {key === 'query' &&
            (view.query?.sorts?.length || view.query?.filters?.length || view.query?.search)
              ? ' •'
              : ''}
          </button>
        ))}
      </div>
      {panel && (
        <dialog
          className="feature-dialog"
          ref={ref}
          aria-labelledby="feature-title"
          onCancel={close}
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div className="feature-content">
            <div className="feature-heading">
              <h2 id="feature-title">
                {panel === 'query'
                  ? 'Sort, filter & search'
                  : panel === 'format'
                    ? 'Column format'
                    : panel === 'freeze'
                      ? 'Freeze panes'
                      : panel === 'paste'
                        ? 'Paste special'
                        : 'Saved views'}
              </h2>
              <button aria-label="Close settings" onClick={close}>
                ×
              </button>
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
              <ViewsPanel store={store} saving={saving} onSwitchView={onSwitchView} close={close} />
            )}
          </div>
        </dialog>
      )}
    </>
  );
}
function columns(store: SpreadsheetStore) {
  return Array.from({ length: store.columns }, (_, i) => {
    const id = store.view!.columns.canonicalAt(i);
    return {
      id,
      label: `${columnLabel(store.view!.columns.logicalIndex(id))}${store.view!.getSnapshot().columns.owned[id]?.label ? ' · ' + store.view!.getSnapshot().columns.owned[id].label : ''}`,
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
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {columns(store).map((c) => (
        <option key={c.id} value={c.id}>
          {c.label}
        </option>
      ))}
    </select>
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
        <input
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
          <select
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
          </select>
          <button
            type="button"
            aria-label={`Remove sort ${i + 1}`}
            onClick={() => setQuery({ ...query, sorts: query.sorts!.filter((_, j) => j !== i) })}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        disabled={(query.sorts?.length ?? 0) >= 3}
        onClick={() =>
          setQuery({ ...query, sorts: [...(query.sorts ?? []), { col: first, direction: 'asc' }] })
        }
      >
        + Add sort
      </button>
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
          <select
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
          </select>
          {!['empty', 'notEmpty'].includes(filter.operator) && (
            <input
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
          <button
            type="button"
            aria-label={`Remove filter ${i + 1}`}
            onClick={() =>
              setQuery({ ...query, filters: query.filters!.filter((_, j) => j !== i) })
            }
          >
            ×
          </button>
        </div>
      ))}
      <button
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
      </button>
      <p className="settings-note">
        Applies to the entire dataset. Row labels and formula references keep their original
        identities. Clear the query before moving or inserting rows.
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="dialog-actions">
        <button
          type="button"
          onClick={() => {
            store.configure({ query: {} });
            close();
          }}
        >
          Clear query
        </button>
        <button className="primary" type="submit">
          Apply query
        </button>
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
        <input
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
        <input
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
        <button
          type="button"
          onClick={() => {
            store.configure({ frozen: { rows: 0, columns: 0 } });
            close();
          }}
        >
          Unfreeze all
        </button>
        <button className="primary" type="submit">
          Apply freeze
        </button>
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
        <select
          autoFocus
          value={option.kind}
          onChange={(e) => setOption({ ...option, kind: e.target.value as CellKind })}
        >
          {['auto', 'text', 'number', 'currency', 'percent', 'date', 'checkbox', 'select'].map(
            (kind) => (
              <option key={kind}>{kind}</option>
            ),
          )}
        </select>
      </label>
      {['number', 'currency', 'percent'].includes(option.kind) && (
        <label className="stack-field">
          Decimal places
          <input
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
          <select
            value={option.currency ?? 'EUR'}
            onChange={(e) => setOption({ ...option, currency: e.target.value })}
          >
            {['EUR', 'CZK', 'USD', 'GBP'].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
      )}
      {option.kind === 'select' && (
        <label className="stack-field">
          Choices (one per line)
          <textarea
            value={option.options?.join('\n') ?? ''}
            onChange={(e) => setOption({ ...option, options: e.target.value.split('\n') })}
          />
        </label>
      )}
      <h3>Conditional formatting</h3>
      {rules.map((rule, i) => (
        <div className="control-row filter-row" key={rule.id}>
          <select
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
          </select>
          {!['empty', 'notEmpty'].includes(rule.operator) && (
            <input
              aria-label={`Rule value ${i + 1}`}
              value={String(rule.value ?? '')}
              onChange={(e) =>
                setRules(rules.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)))
              }
            />
          )}
          <input
            type="color"
            aria-label={`Rule background ${i + 1}`}
            value={rule.background}
            onChange={(e) =>
              setRules(rules.map((r, j) => (j === i ? { ...r, background: e.target.value } : r)))
            }
          />
          <input
            type="color"
            aria-label={`Rule text color ${i + 1}`}
            value={rule.color}
            onChange={(e) =>
              setRules(rules.map((r, j) => (j === i ? { ...r, color: e.target.value } : r)))
            }
          />
          <button
            type="button"
            aria-label={`Remove rule ${i + 1}`}
            onClick={() => setRules(rules.filter((_, j) => j !== i))}
          >
            ×
          </button>
        </div>
      ))}
      <button
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
      </button>
      <p className="settings-note">
        The first matching rule wins. Types validate new inputs; existing values are preserved.
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="dialog-actions">
        <button className="primary" type="submit">
          Apply format
        </button>
      </div>
    </form>
  );
}
function ViewsPanel({
  store,
  saving,
  onSwitchView,
  close,
}: {
  store: SpreadsheetStore;
  saving: ViewPersistenceBinding;
  onSwitchView: (id: string) => Promise<void>;
  close: () => void;
}) {
  const [views, setViews] = useState<ViewSummary[]>([]),
    [name, setName] = useState(store.view!.getSnapshot().name ?? 'October sales'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    void saving
      .flush()
      .then(() =>
        new LocalStorageViewAdapter(localStorage).list(
          store.view!.getSnapshot().sourceId,
          c.signal,
        ),
      )
      .then((v) => {
        if (!c.signal.aborted) setViews(v);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(String(e));
      });
    return () => c.abort();
  }, [store, saving]);
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
        <input autoFocus maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="dialog-actions">
        <button
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
        </button>
        <button
          className="primary"
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
              await new LocalStorageViewAdapter(localStorage).save(
                state,
                null,
                new AbortController().signal,
              );
              close();
              await onSwitchView(state.viewId);
            })
          }
        >
          Save as new view
        </button>
      </div>
      <h3>Your views</h3>
      <div className="view-list">
        {views.map((view) => (
          <button
            disabled={busy || view.viewId === store.view!.getSnapshot().viewId}
            key={view.viewId}
            onClick={() =>
              run(async () => {
                close();
                await onSwitchView(view.viewId);
              })
            }
          >
            {view.name}
            {view.viewId === store.view!.getSnapshot().viewId ? ' · current' : ' →'}
          </button>
        ))}
      </div>
      <p className="settings-note">
        Each view saves its layout, query, formats, frozen panes and calculations in this browser.
      </p>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
