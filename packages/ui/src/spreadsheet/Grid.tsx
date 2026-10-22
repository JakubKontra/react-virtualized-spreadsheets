import type { CSSProperties, RefObject } from 'react';
import { CellRange, type Address, type SpreadsheetStore } from '@sheet/core';
import { useStableCallback, type SpreadsheetController } from '@sheet/react';
import { Cell } from './Cell';
import { CellEditor } from './CellEditor';
import { ColumnHeaders } from './ColumnHeaders';
import { RowHeader } from './RowHeader';

export interface GridProps {
  readonly store: SpreadsheetStore;
  readonly sheet: SpreadsheetController;
  readonly scrollRef: RefObject<HTMLDivElement | null>;
  readonly editorRef: RefObject<HTMLInputElement | null>;
  readonly height: CSSProperties['height'];
  readonly locale: string;
  readonly number: Intl.NumberFormat;
  /** Formula assist popup describing the cell editor, when shown. */
  readonly assistId: string | undefined;
}

export function Grid({
  store,
  sheet,
  scrollRef,
  editorRef,
  height,
  locale,
  number,
  assistId,
}: GridProps) {
  const { state, layout, selection } = sheet;
  const active = state.active;
  const toggle = useStableCallback(async (address: Address, value: boolean) => {
    if (!(await sheet.edit.commit())) return;
    await store.ensureRange(CellRange.of(address));
    await store.edit([{ ...address, input: value }]);
    store.select(address);
  });
  const showHandle = !state.editing && state.selectionKind === 'cells';
  return (
    <div
      {...sheet.props.grid}
      ref={scrollRef}
      className="grid-scroll"
      data-testid="grid"
      style={{ height }}
    >
      <div className="grid-canvas" style={{ width: layout.totalWidth, height: layout.totalHeight }}>
        <ColumnHeaders store={store} sheet={sheet} />
        {layout.virtualRows.map((row) => (
          <div
            role="row"
            aria-rowindex={row.index + 1}
            key={row.key}
            className="grid-row"
            style={{
              top: layout.displayRow(row.index, row.start),
              width: layout.totalWidth,
              height: row.size,
              zIndex: row.index < layout.frozenRows ? 4 : undefined,
            }}
          >
            <RowHeader
              store={store}
              sheet={sheet}
              row={row}
              selected={active.row === row.index}
              number={number}
            />
            {layout.virtualColumns.map((col) => (
              <Cell
                key={col.key}
                store={store}
                locale={locale}
                row={row.index}
                col={col.index}
                props={sheet.props.cell({ row: row.index, col: col.index })}
                left={layout.displayColumn(col.index, col.start)}
                frozen={col.index < layout.frozenColumns}
                toggle={toggle}
                handle={
                  showHandle && row.index === selection.end.row && col.index === selection.end.col
                    ? sheet.props.fillHandle
                    : undefined
                }
                width={col.size}
                active={active.row === row.index && active.col === col.index}
              />
            ))}
          </div>
        ))}
        {state.editing && state.editor === 'cell' && (
          <CellEditor
            store={store}
            address={state.editing}
            props={sheet.props.editor}
            rect={layout.cellRect(state.editing)}
            inputRef={editorRef}
            describedBy={assistId}
          />
        )}
      </div>
      {(state.querying || !store.rows) && (
        <div className="grid-message" role="status">
          {state.querying
            ? 'Searching and sorting every row…'
            : 'No matching rows. Clear or adjust your filters.'}
        </div>
      )}
    </div>
  );
}
