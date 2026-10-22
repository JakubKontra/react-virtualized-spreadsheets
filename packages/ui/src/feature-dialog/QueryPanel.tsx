import { useState } from 'react';
import { LIMITS, type ViewQuery } from '@sheet/core';
import { Button } from '../components/button';
import { Input } from '../components/input';
import { FilterList } from './FilterList';
import { SortList } from './SortList';
import type { ViewPanelProps } from './types';
import { useSettingsForm } from './use-settings-form';

export function QueryPanel({ store, view, close }: ViewPanelProps) {
  const [query, setQuery] = useState<ViewQuery>(() => view.getSnapshot().query ?? {});
  const form = useSettingsForm(close);
  const defaultColumn = view.columns.canonicalAt(store.getSnapshot().active.col);
  return (
    <form onSubmit={form.submit(() => store.configure({ query }))}>
      <label className="stack-field">
        Search all visible columns
        <Input
          autoFocus
          type="search"
          maxLength={LIMITS.maxSearchLength}
          value={query.search ?? ''}
          onChange={(event) => setQuery({ ...query, search: event.target.value })}
          placeholder="Find across every row…"
        />
      </label>
      <SortList
        view={view}
        sorts={query.sorts ?? []}
        defaultColumn={defaultColumn}
        onChange={(sorts) => setQuery({ ...query, sorts })}
      />
      <FilterList
        view={view}
        filters={query.filters ?? []}
        defaultColumn={defaultColumn}
        onChange={(filters) => setQuery({ ...query, filters })}
      />
      <p className="settings-note">
        Applies to the entire dataset. Row labels and formula references keep their original
        identities. Clear the query before moving or inserting rows.
      </p>
      {form.error && <p role="alert">{form.error}</p>}
      <div className="dialog-actions">
        <Button
          variant="outline"
          type="button"
          onClick={() => form.run(() => store.configure({ query: {} }))}
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
