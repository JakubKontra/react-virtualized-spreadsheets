import { useRef } from 'react';
import { isError, type Address, type SpreadsheetStore } from '@sheet/core';
import { useCell, useSpreadsheet } from '@sheet/react';

function Value({ store, address }: { store: SpreadsheetStore; address: Address }) {
  const cell = useCell(store, address);
  if (cell.status === 'loading') return <>…</>;
  return <>{isError(cell.value) ? cell.value.error : String(cell.value ?? '')}</>;
}

export function Grid({ store }: { store: SpreadsheetStore }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const sheet = useSpreadsheet({ store, scrollRef, rowHeaderWidth: 0, columnHeaderHeight: 0 });
  const { layout, props, state } = sheet;
  return (
    <div ref={scrollRef} {...props.grid} style={{ height: 400, overflow: 'auto' }}>
      <div style={{ position: 'relative', height: layout.totalHeight, width: layout.totalWidth }}>
        {layout.virtualRows.map((row) => (
          <div
            key={row.key}
            role="row"
            style={{
              position: 'absolute',
              top: row.start,
              height: row.size,
              width: layout.totalWidth,
            }}
          >
            {layout.virtualColumns.map((col) => {
              const address: Address = { row: row.index, col: col.index };
              return (
                <div
                  key={col.key}
                  {...props.cell(address)}
                  style={{
                    position: 'absolute',
                    left: col.start,
                    width: col.size,
                    height: row.size,
                    border: '1px solid #d4d4d8',
                    padding: 4,
                  }}
                >
                  <Value store={store} address={address} />
                </div>
              );
            })}
          </div>
        ))}
        {state.editing && (
          <input
            {...props.editor}
            autoFocus
            style={{ position: 'absolute', ...layout.cellRect(state.editing) }}
          />
        )}
      </div>
    </div>
  );
}
