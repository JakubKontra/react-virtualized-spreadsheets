import { Address, columnLabel, type ColIndex, type SpreadsheetStore } from '@sheet/core';
import type { SpreadsheetController, VirtualColumn } from '@sheet/react';
import { useColumnLabelResolver } from '../context';
import { canonicalColumn, columnName } from '../lib/column-labels';
import { afterCommit } from './after-commit';

export interface ColumnHeadersProps {
  readonly store: SpreadsheetStore;
  readonly sheet: SpreadsheetController;
}

function letter(store: SpreadsheetStore, col: ColIndex): string {
  return columnLabel(store.logicalAddress(Address.unsafe(0, col)).col);
}

export function ColumnHeaders({ store, sheet }: ColumnHeadersProps) {
  return (
    <div className="column-headers" role="row" style={{ width: sheet.layout.totalWidth }}>
      <div className="corner" role="columnheader">
        <button
          aria-label="Select all cells"
          onClick={() => afterCommit(sheet, () => store.selectAll())}
        >
          ◩
        </button>
      </div>
      {sheet.layout.virtualColumns.map((col) => (
        <ColumnHeader key={col.key} store={store} sheet={sheet} col={col} />
      ))}
    </div>
  );
}

function ColumnHeader({ store, sheet, col }: ColumnHeadersProps & { readonly col: VirtualColumn }) {
  const getColumnLabel = useColumnLabelResolver();
  const { layout, gestures } = sheet;
  const view = store.view;
  const frozen = col.index < layout.frozenColumns;
  const label = letter(store, col.index);
  return (
    <div
      {...gestures.headerProps('columns', col.index)}
      role="columnheader"
      aria-colindex={col.index + 1}
      className={`column-header ${view?.columns.isOwned(col.index) ? 'formula-column' : ''}`}
      data-column-id={store.source.columnId(col.index)}
      style={{
        left: layout.displayColumn(col.index, col.start),
        width: col.size,
        zIndex: frozen ? 2 : undefined,
        background: frozen ? 'var(--sheet-muted)' : undefined,
      }}
    >
      <button
        className="column-letter drag-handle"
        {...(view
          ? gestures.dragProps('columns', col.index)
          : {
              'aria-label': `Select column ${col.index + 1}`,
              onClick: () => afterCommit(sheet, () => store.selectAxis('columns', col.index)),
            })}
      >
        {label}
      </button>
      <span className="column-name">
        {columnName(view, canonicalColumn(store, col.index), getColumnLabel) ?? ''}
      </span>
      {view && (
        <button
          className="header-menu-button"
          aria-haspopup="dialog"
          aria-label={`Column ${label} menu`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            void gestures.openMenu('columns', col.index, rect.left, rect.bottom);
          }}
        >
          ⌄
        </button>
      )}
      {view && <span className="column-resizer" {...gestures.resizeProps('columns', col.index)} />}
    </div>
  );
}
