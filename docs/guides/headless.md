# Build your own renderer

Use `@sheet/react` when your product needs its own UI components. It provides virtual geometry, subscriptions, keyboard navigation and interaction props without requiring Tailwind or shadcn/ui.

The host creates a store as described in [data sources](data-sources.md). This minimal renderer then adds an editable viewport:

```tsx
import { useRef } from 'react';
import { isError, type SpreadsheetStore } from '@sheet/core';
import { useCell, useSpreadsheet } from '@sheet/react';

function Value({ store, row, col }: { store: SpreadsheetStore; row: number; col: number }) {
  const cell = useCell(store, row, col);
  if (cell.status === 'loading') return <>…</>;
  return <>{isError(cell.value) ? cell.value.error : String(cell.value ?? '')}</>;
}

export function Grid({ store }: { store: SpreadsheetStore }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const grid = useSpreadsheet({
    store,
    scrollRef,
    rowHeaderWidth: 0,
    columnHeaderHeight: 0,
  });
  return (
    <div ref={scrollRef} {...grid.gridProps} style={{ height: 400, overflow: 'auto' }}>
      <div style={{ position: 'relative', height: grid.totalHeight, width: grid.totalWidth }}>
        {grid.virtualRows.map((row) => (
          <div
            key={row.key}
            role="row"
            style={{
              position: 'absolute',
              top: row.start,
              height: row.size,
              width: grid.totalWidth,
            }}
          >
            {grid.virtualColumns.map((col) => (
              <div
                key={col.key}
                {...grid.getCellProps({ row: row.index, col: col.index })}
                style={{
                  position: 'absolute',
                  left: col.start,
                  width: col.size,
                  height: row.size,
                  border: '1px solid #d4d4d8',
                  padding: 4,
                }}
              >
                <Value store={store} row={row.index} col={col.index} />
              </div>
            ))}
          </div>
        ))}
        {grid.state.editing && (
          <input
            {...grid.editorProps}
            autoFocus
            style={{ position: 'absolute', ...grid.cellRect(grid.state.editing) }}
          />
        )}
      </div>
    </div>
  );
}
```

This example covers basic editing in an unpinned view. It omits headers, frozen positioning, selection overlays, error UI and formula assistance. For a complete renderer, see `packages/ui/src/Spreadsheet.tsx` and the [React API](../api/react.md).

## Keep interaction props together

Attach `gridProps` to the scrolling, focusable element. Attach `getCellProps(address)` to every cell. Keep the editor outside virtual rows so scrolling cannot unmount the draft. Preserve the styles returned by `getCellProps` when adding your own styling if you want formula-reference highlights.

`useCell` subscribes to one cell. Avoid subscribing each cell to the full store snapshot. Keep column-width callbacks stable; changed widths invalidate geometry. For frozen rows and columns, use `displayRow`, `displayColumn`, and the hook's pinned counts to position and layer cells.

## Add product controls

Use `formulaBarProps` for a synchronized formula input, `gestures` for header moves/resizes, and `fillHandleProps` for autofill. Use `commitEdit()` before actions that depend on a pending draft. The renderer must surface `state.error`, connection status and loading state.

The returned props include ARIA grid roles, counts and selection metadata. A custom renderer still needs visible focus, accessible control names and assistive-technology testing. The current project has not completed a cross-browser screen-reader audit.
