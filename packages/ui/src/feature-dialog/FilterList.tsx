import {
  filterValue,
  LIMITS,
  operatorTakesValue,
  withFilterOperator,
  withFilterValue,
  type CanonicalCol,
  type ColumnFilter,
  type ViewController,
} from '@sheet/core';
import { Button } from '../components/button';
import { Input } from '../components/input';
import { ColumnSelect } from '../fields/ColumnSelect';
import { OptionSelect } from '../fields/OptionSelect';
import { removeAt, replaceAt } from '../lib/arrays';
import { OPERATOR_OPTIONS } from './operator-options';

export interface FilterListProps {
  readonly view: ViewController;
  readonly filters: readonly ColumnFilter[];
  /** Column a new filter starts on. */
  readonly defaultColumn: CanonicalCol;
  readonly onChange: (filters: readonly ColumnFilter[]) => void;
}

export function FilterList({ view, filters, defaultColumn, onChange }: FilterListProps) {
  return (
    <>
      <h3>Filters · match all</h3>
      {filters.map((filter, i) => (
        <div className="control-row filter-row" key={i}>
          <ColumnSelect
            view={view}
            value={filter.col}
            label={`Filter column ${i + 1}`}
            onValueChange={(col) => onChange(replaceAt(filters, i, { ...filter, col }))}
          />
          <OptionSelect
            aria-label={`Filter condition ${i + 1}`}
            options={OPERATOR_OPTIONS}
            value={filter.operator}
            onValueChange={(operator) =>
              onChange(replaceAt(filters, i, withFilterOperator(filter, operator)))
            }
          />
          {operatorTakesValue(filter.operator) && (
            <Input
              aria-label={`Filter value ${i + 1}`}
              value={String(filterValue(filter) ?? '')}
              onChange={(event) =>
                onChange(replaceAt(filters, i, withFilterValue(filter, event.target.value)))
              }
            />
          )}
          <Button
            variant="outline"
            type="button"
            aria-label={`Remove filter ${i + 1}`}
            onClick={() => onChange(removeAt(filters, i))}
          >
            ×
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        type="button"
        disabled={filters.length >= LIMITS.maxFilters}
        onClick={() =>
          onChange([...filters, { col: defaultColumn, operator: 'contains', value: '' }])
        }
      >
        + Add filter
      </Button>
    </>
  );
}
