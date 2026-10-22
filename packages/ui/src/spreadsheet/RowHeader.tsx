import { Address, type SpreadsheetStore } from '@sheet/core';
import type { SpreadsheetController, VirtualRow } from '@sheet/react';
import { afterCommit } from './after-commit';

export interface RowHeaderProps {
  readonly store: SpreadsheetStore;
  readonly sheet: SpreadsheetController;
  readonly row: VirtualRow;
  readonly selected: boolean;
  readonly number: Intl.NumberFormat;
}

export function RowHeader({ store, sheet, row, selected, number }: RowHeaderProps) {
  const { gestures } = sheet;
  const view = store.view;
  const position = store.logicalAddress(Address.unsafe(row.index, 0)).row + 1;
  return (
    <div
      {...gestures.headerProps('rows', row.index)}
      role="rowheader"
      data-row-id={store.source.rowId(row.index)}
      className={`row-header ${selected ? 'selected' : ''}`}
    >
      <button
        className="row-drag-handle"
        {...(view
          ? gestures.dragProps('rows', row.index)
          : {
              'aria-label': `Select row ${row.index + 1}`,
              onClick: () => afterCommit(sheet, () => store.selectAxis('rows', row.index)),
            })}
      >
        {number.format(position)}
      </button>
      {view && (
        <button
          className="row-menu-button"
          aria-haspopup="dialog"
          aria-label={`Row ${position} menu`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            void gestures.openMenu('rows', row.index, rect.right, rect.top);
          }}
        >
          ⋮
        </button>
      )}
      {view && <span className="row-resizer" {...gestures.resizeProps('rows', row.index)} />}
    </div>
  );
}
