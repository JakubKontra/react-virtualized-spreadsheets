import { useMemo } from 'react';
import type { CanonicalCol, ViewController } from '@sheet/core';
import { useColumnLabelResolver } from '../context';
import { columnOptions } from '../lib/column-labels';
import { OptionSelect } from './OptionSelect';

export interface ColumnSelectProps {
  readonly view: ViewController;
  readonly value: CanonicalCol;
  readonly onValueChange: (col: CanonicalCol) => void;
  readonly label: string;
}

/** Picks a column by its stable canonical identity; option values are `String(canonical)`. */
export function ColumnSelect({ view, value, onValueChange, label }: ColumnSelectProps) {
  const getColumnLabel = useColumnLabelResolver();
  const options = useMemo(() => columnOptions(view, getColumnLabel), [view, getColumnLabel]);
  return (
    <OptionSelect
      aria-label={label}
      options={options}
      value={value}
      onValueChange={onValueChange}
    />
  );
}
