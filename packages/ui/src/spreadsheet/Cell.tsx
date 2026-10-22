import { memo, useMemo, type CSSProperties } from 'react';
import {
  Address,
  formatCellValue,
  isError,
  isFormula,
  matchesFilter,
  type CellSnapshot,
  type ColIndex,
  type ConditionalRule,
  type RowIndex,
  type SpreadsheetStore,
} from '@sheet/core';
import { useCell, type CellProps, type FillHandleProps } from '@sheet/react';
import { clsx } from 'clsx';
import { canonicalColumn } from '../lib/column-labels';

export interface CellViewProps {
  readonly store: SpreadsheetStore;
  readonly locale: string;
  readonly row: RowIndex;
  readonly col: ColIndex;
  readonly props: CellProps;
  readonly left: number;
  readonly width: number;
  readonly active: boolean;
  readonly frozen: boolean;
  readonly toggle: (address: Address, value: boolean) => Promise<void>;
  /** Present on the cell that carries the fill handle. */
  readonly handle?: FillHandleProps | undefined;
}

function ruleStyle(rule: ConditionalRule | undefined): CSSProperties {
  return rule
    ? { color: rule.color, background: rule.background, fontWeight: rule.bold ? 700 : undefined }
    : {};
}

function cellTitle(cell: CellSnapshot): string | undefined {
  if (isError(cell.value)) return cell.value.message;
  return isFormula(cell.input) ? cell.input : undefined;
}

export const Cell = memo(function Cell({
  store,
  locale,
  row,
  col,
  props,
  left,
  width,
  active,
  frozen,
  toggle,
  handle,
}: CellViewProps) {
  const address = useMemo(() => Address.unsafe(row, col), [row, col]);
  const cell = useCell(store, address);
  const option = store.columnOptions(col);
  const canonical = canonicalColumn(store, col);
  const rule = store.view
    ?.getSnapshot()
    .conditionalRules?.find((r) => r.col === canonical && matchesFilter(cell.value, r));
  const checkbox =
    option?.kind === 'checkbox' && (typeof cell.value === 'boolean' || cell.value === null);
  return (
    <div
      {...props}
      className={clsx(
        'cell',
        typeof cell.value === 'number' && 'numeric',
        store.view?.columns.isOwned(col) && 'computed',
        active && 'current',
        frozen && 'frozen-cell',
        cell.status === 'error' && 'cell-error',
        cell.status === 'calculating' && 'calculating',
      )}
      style={{ left, width, ...ruleStyle(rule), ...props.style }}
      title={cellTitle(cell)}
      data-status={cell.status}
    >
      {cell.status === 'loading' ? (
        <span className="skeleton" />
      ) : checkbox ? (
        <input
          type="checkbox"
          aria-label={`Toggle ${store.labelAddress(address)}`}
          checked={cell.value === true}
          disabled={!store.source.isEditable(address) || cell.status === 'calculating'}
          onPointerDown={(event) => event.stopPropagation()}
          onChange={(event) => {
            toggle(address, event.target.checked).catch((error: unknown) => store.setError(error));
          }}
        />
      ) : (
        <span>{formatCellValue(cell.value, option, locale)}</span>
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
