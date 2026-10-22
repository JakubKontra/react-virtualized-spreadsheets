import { Popover, PopoverContent } from './components/popover';
import { Button } from './components/button';
import { Input } from './components/input';
import { Separator } from './components/separator';
import { useEffect, useRef, useState, useId, type RefObject } from 'react';
import type { useSpreadsheet } from '@sheet/react';
import type { ViewChange } from '@sheet/core';

type Sheet = ReturnType<typeof useSpreadsheet>;
export function ViewControls({
  sheet,
  store,
  scrollRef,
}: {
  sheet: Sheet;
  scrollRef: RefObject<HTMLDivElement | null>;
  store: import('@sheet/core').SpreadsheetStore;
}) {
  const id = useId();
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
  }, [menu]);
  const preview = sheet.gestures.preview;
  if (!store.view) return null;
  const close = () => {
    sheet.gestures.setMenu(null);
    scrollRef.current?.focus({ preventScroll: true });
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
        <Popover
          open={!!menu}
          modal="trap-focus"
          onOpenChange={(open) => {
            if (!open) close();
          }}
        >
          <PopoverContent
            anchor={{
              getBoundingClientRect: () =>
                DOMRect.fromRect({ x: menu.x, y: menu.y, width: 0, height: 0 }),
            }}
            align="start"
            sideOffset={0}
            finalFocus={scrollRef}
            className="header-menu"
            role="dialog"
            aria-label={`${noun} actions`}
            ref={ref}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                close();
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
              {selected.count === 1
                ? `${noun} ${menu.index + 1}`
                : `${selected.count} ${menu.axis}`}{' '}
              <span>VIEW ONLY</span>
            </div>
            <Button
              variant="ghost"
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
            </Button>
            <Button
              variant="ghost"
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
            </Button>
            <Separator className="my-1" />
            <Button
              variant="ghost"
              disabled={selected.start === 0}
              onClick={() =>
                run({ type: 'move', axis: menu.axis, ...selected, before: selected.start - 1 })
              }
            >
              Move {menu.axis === 'rows' ? 'up' : 'left'} <kbd aria-hidden="true">Alt + arrow</kbd>
            </Button>
            <Button
              variant="ghost"
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
            </Button>
            <form
              className="menu-field"
              onSubmit={(event) => {
                event.preventDefault();
                run({ type: 'move', axis: menu.axis, ...selected, before: Number(position) - 1 });
              }}
            >
              <label htmlFor={`${id}-move`}>Before position</label>
              <Input
                id={`${id}-move`}
                type="number"
                min={1}
                max={axis.count + 1}
                value={position}
                onChange={(event) => setPosition(event.target.value)}
              />
              <Button variant="ghost" type="submit" aria-label="Apply move">
                ↵
              </Button>
            </form>
            <form
              className="menu-field"
              onSubmit={(event) => {
                event.preventDefault();
                run({ type: 'resize', axis: menu.axis, ...selected, size: Number(size) });
              }}
            >
              <label htmlFor={`${id}-size`}>{menu.axis === 'rows' ? 'Height' : 'Width'} (px)</label>
              <Input
                id={`${id}-size`}
                type="number"
                min={menu.axis === 'rows' ? 24 : 48}
                max={2000}
                value={size}
                onChange={(event) => setSize(event.target.value)}
              />
              <Button variant="ghost" type="submit" aria-label="Apply size">
                ↵
              </Button>
            </form>
            <Separator className="my-1" />
            <Button
              variant="ghost"
              onClick={() => run({ type: 'hide', axis: menu.axis, ...selected })}
            >
              Hide {selected.count === 1 ? noun : menu.axis}
            </Button>
            <Button
              variant="ghost"
              disabled={!axis.state.hidden.length}
              onClick={() => run({ type: 'showAll', axis: menu.axis })}
            >
              Show hidden {menu.axis}
            </Button>
            <Button
              variant="ghost"
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
            </Button>
            <div className="menu-note">Changes affect this view. Undo is available.</div>
          </PopoverContent>
        </Popover>
      )}
    </>
  );
}
