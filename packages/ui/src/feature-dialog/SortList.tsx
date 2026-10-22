import {
  LIMITS,
  SORT_DIRECTIONS,
  type CanonicalCol,
  type ColumnSort,
  type ViewController,
} from '@sheet/core';
import { Button } from '../components/button';
import { ColumnSelect } from '../fields/ColumnSelect';
import { OptionSelect } from '../fields/OptionSelect';
import { removeAt, replaceAt } from '../lib/arrays';
import { SORT_DIRECTION_LABELS } from '../lib/labels';
import { optionsFromLabels } from '../lib/options';

const DIRECTION_OPTIONS = optionsFromLabels(SORT_DIRECTIONS, SORT_DIRECTION_LABELS);

export interface SortListProps {
  readonly view: ViewController;
  readonly sorts: readonly ColumnSort[];
  /** Column a new sort starts on. */
  readonly defaultColumn: CanonicalCol;
  readonly onChange: (sorts: readonly ColumnSort[]) => void;
}

export function SortList({ view, sorts, defaultColumn, onChange }: SortListProps) {
  return (
    <>
      <h3>Sort priority</h3>
      {sorts.map((sort, i) => (
        <div className="control-row" key={i}>
          <ColumnSelect
            view={view}
            value={sort.col}
            label={`Sort column ${i + 1}`}
            onValueChange={(col) => onChange(replaceAt(sorts, i, { ...sort, col }))}
          />
          <OptionSelect
            aria-label={`Sort direction ${i + 1}`}
            options={DIRECTION_OPTIONS}
            value={sort.direction}
            onValueChange={(direction) => onChange(replaceAt(sorts, i, { ...sort, direction }))}
          />
          <Button
            variant="outline"
            type="button"
            aria-label={`Remove sort ${i + 1}`}
            onClick={() => onChange(removeAt(sorts, i))}
          >
            ×
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        type="button"
        disabled={sorts.length >= LIMITS.maxSorts}
        onClick={() => onChange([...sorts, { col: defaultColumn, direction: 'asc' }])}
      >
        + Add sort
      </Button>
    </>
  );
}
