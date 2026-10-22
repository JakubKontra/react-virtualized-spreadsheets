import { useEffect, useRef, useState } from 'react';
import type { useSpreadsheet } from '@sheet/react';
import type { ViewChange } from '@sheet/core';

type Sheet = ReturnType<typeof useSpreadsheet>;
export function ViewControls({
  sheet,
  store,
}: {
  sheet: Sheet;
  store: import('@sheet/core').SpreadsheetStore;
}) {
  const menu = sheet.gestures.menu;
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState('');
  const [position, setPosition] = useState('');
  useEffect(() => {
    if (!menu) return;
    const rect = sheet.cellRect(
      menu.axis === 'rows' ? { row: menu.index, col: 0 } : { row: 0, col: menu.index },
    );
    setSize(String(menu.axis === 'rows' ? rect.height : rect.width));
    setPosition(String(menu.index + 1));
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const outside = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) sheet.gestures.setMenu(null);
    };
    window.addEventListener('pointerdown', outside);
    return () => window.removeEventListener('pointerdown', outside);
  }, [menu]);
  const preview = sheet.gestures.preview;
  if (!store.view) return null;
  const close = () => {
    sheet.gestures.setMenu(null);
    document.querySelector<HTMLElement>('[data-testid=grid]')?.focus({ preventScroll: true });
  };
  const selected = menu ? sheet.gestures.selection(menu.axis, menu.index) : { start: 0, count: 1 };
  const axis = menu ? store.view[menu.axis] : null;
  const canRemove =
    axis &&
    selected.count <= Object.keys(axis.state.owned).length &&
    Array.from({ length: selected.count }, (_, i) => selected.start + i).every((index) =>
      axis.isOwned(index),
    );
  const noun = menu?.axis === 'rows' ? 'row' : 'column';
  const run = (change: ViewChange) => {
    void sheet.gestures.run(change);
  };
  return (
    <>
      <span className="sr-only" aria-live="polite">
        {sheet.gestures.announcement}
      </span>
      {preview && (
        <>
          <div className="drop-line" data-testid="drop-line" style={preview.line} />
          <div className="drag-preview" style={{ left: preview.x + 16, top: preview.y + 14 }}>
            {preview.kind === 'resize'
              ? `${preview.size} px`
              : `Move ${preview.count} ${preview.count === 1 ? (preview.axis === 'rows' ? 'row' : 'column') : preview.axis}`}
          </div>
        </>
      )}
      {menu && axis && (
        <div
          className="header-menu"
          role="dialog"
          aria-label={`${noun} actions`}
          ref={ref}
          style={{ left: menu.x, top: menu.y }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              close();
            }
            if (event.key === 'Tab') {
              event.preventDefault();
              const items = [
                ...ref.current!.querySelectorAll<HTMLElement>(
                  'button:not(:disabled), input:not(:disabled)',
                ),
              ];
              const index = items.indexOf(event.target as HTMLElement);
              items[(index + (event.shiftKey ? -1 : 1) + items.length) % items.length]?.focus();
            }
            if (
              ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) &&
              event.target instanceof HTMLButtonElement
            ) {
              event.preventDefault();
              const items = [
                ...ref.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
              ];
              const index = items.indexOf(event.target);
              items[
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? items.length - 1
                    : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
              ]?.focus();
            }
          }}
        >
          <div className="menu-heading">
            {selected.count === 1 ? `${noun} ${menu.index + 1}` : `${selected.count} ${menu.axis}`}{' '}
            <span>VIEW ONLY</span>
          </div>
          <button
            onClick={() =>
              run({
                type: 'insert',
                axis: menu.axis,
                before: selected.start,
                label: menu.axis === 'columns' ? 'Calculation' : undefined,
              })
            }
          >
            Insert {noun} {menu.axis === 'rows' ? 'above' : 'before'}
          </button>
          <button
            onClick={() =>
              run({
                type: 'insert',
                axis: menu.axis,
                before: selected.start + selected.count,
                label: menu.axis === 'columns' ? 'Calculation' : undefined,
              })
            }
          >
            Insert {noun} {menu.axis === 'rows' ? 'below' : 'after'}
          </button>
          <div className="menu-divider" />
          <button
            disabled={selected.start === 0}
            onClick={() =>
              run({ type: 'move', axis: menu.axis, ...selected, before: selected.start - 1 })
            }
          >
            Move {menu.axis === 'rows' ? 'up' : 'left'} <kbd aria-hidden="true">Alt + arrow</kbd>
          </button>
          <button
            disabled={selected.start + selected.count === axis.count}
            onClick={() =>
              run({
                type: 'move',
                axis: menu.axis,
                ...selected,
                before: selected.start + selected.count + 1,
              })
            }
          >
            Move {menu.axis === 'rows' ? 'down' : 'right'}
          </button>
          <form
            className="menu-field"
            onSubmit={(event) => {
              event.preventDefault();
              run({ type: 'move', axis: menu.axis, ...selected, before: Number(position) - 1 });
            }}
          >
            <label htmlFor="move-position">Before position</label>
            <input
              id="move-position"
              type="number"
              min={1}
              max={axis.count + 1}
              value={position}
              onChange={(event) => setPosition(event.target.value)}
            />
            <button type="submit" aria-label="Apply move">
              ↵
            </button>
          </form>
          <form
            className="menu-field"
            onSubmit={(event) => {
              event.preventDefault();
              run({ type: 'resize', axis: menu.axis, ...selected, size: Number(size) });
            }}
          >
            <label htmlFor="axis-size">{menu.axis === 'rows' ? 'Height' : 'Width'} (px)</label>
            <input
              id="axis-size"
              type="number"
              min={menu.axis === 'rows' ? 24 : 48}
              max={2000}
              value={size}
              onChange={(event) => setSize(event.target.value)}
            />
            <button type="submit" aria-label="Apply size">
              ↵
            </button>
          </form>
          <div className="menu-divider" />
          <button onClick={() => run({ type: 'hide', axis: menu.axis, ...selected })}>
            Hide {selected.count === 1 ? noun : menu.axis}
          </button>
          <button
            disabled={!axis.state.hidden.length}
            onClick={() => run({ type: 'showAll', axis: menu.axis })}
          >
            Show hidden {menu.axis}
          </button>
          <button
            className="danger"
            disabled={!canRemove}
            title={
              !canRemove
                ? 'Source items can be hidden; only custom items can be removed.'
                : undefined
            }
            onClick={() => run({ type: 'remove', axis: menu.axis, ...selected })}
          >
            Remove custom {selected.count === 1 ? noun : menu.axis}
          </button>
          <div className="menu-note">Changes affect this view. Undo is available.</div>
        </div>
      )}
    </>
  );
}
