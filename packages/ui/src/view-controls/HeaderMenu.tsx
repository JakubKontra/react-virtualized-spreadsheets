import { useId, useRef, useState, type RefObject } from 'react';
import { Address, type ViewController } from '@sheet/core';
import type { HeaderMenu as Menu, SpreadsheetController } from '@sheet/react';
import { Button } from '../components/button';
import { Input } from '../components/input';
import { Popover, PopoverContent } from '../components/popover';
import { Separator } from '../components/separator';
import { parseIntInput } from '../lib/parse';
import {
  AXIS_NOUNS,
  axisInfo,
  axisNoun,
  changeOnAxis,
  MAX_SIZE,
  MIN_SIZE,
  type AxisChangeBuilder,
} from './axis';
import { moveMenuFocus } from './menu-navigation';

export interface HeaderMenuProps {
  readonly sheet: SpreadsheetController;
  readonly view: ViewController;
  readonly menu: Menu;
  readonly scrollRef: RefObject<HTMLDivElement | null>;
}

function initialSize(sheet: SpreadsheetController, menu: Menu): number {
  switch (menu.axis) {
    case 'rows':
      return sheet.layout.cellRect(Address.unsafe(menu.index, 0)).height;
    case 'columns':
      return sheet.layout.cellRect(Address.unsafe(0, menu.index)).width;
  }
}

/** Actions on the selected rows or columns. Remounted for each header it opens on. */
export function HeaderMenu({ sheet, view, menu, scrollRef }: HeaderMenuProps) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(() => String(initialSize(sheet, menu)));
  const [position, setPosition] = useState(() => String(menu.index + 1));
  const { gestures } = sheet;
  const close = () => {
    gestures.closeMenu();
    scrollRef.current?.focus({ preventScroll: true });
  };
  const selected = gestures.selection(menu.axis, menu.index);
  const info = axisInfo(view, menu.axis);
  const canRemove = info.canRemove(selected);
  const noun = AXIS_NOUNS[menu.axis].one;
  const many = axisNoun(menu.axis, selected.count);
  const isRows = menu.axis === 'rows';
  const run = (build: AxisChangeBuilder) => {
    void gestures.run(changeOnAxis(menu.axis, build));
  };
  const insert = (before: number) =>
    run((axis, at) => ({
      type: 'insert',
      axis,
      before: at(before),
      label: axis === 'columns' ? 'Calculation' : undefined,
    }));
  const move = (before: number) =>
    run((axis, at) => ({
      type: 'move',
      axis,
      start: at(selected.start),
      count: selected.count,
      before: at(before),
    }));
  return (
    <Popover
      open
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
          moveMenuFocus(event, ref.current);
        }}
      >
        <div className="menu-heading">
          {selected.count === 1 ? `${noun} ${menu.index + 1}` : `${selected.count} ${menu.axis}`}{' '}
          <span>VIEW ONLY</span>
        </div>
        <Button variant="ghost" onClick={() => insert(selected.start)}>
          Insert {noun} {isRows ? 'above' : 'before'}
        </Button>
        <Button variant="ghost" onClick={() => insert(selected.start + selected.count)}>
          Insert {noun} {isRows ? 'below' : 'after'}
        </Button>
        <Separator className="my-1" />
        <Button
          variant="ghost"
          disabled={selected.start === 0}
          onClick={() => move(selected.start - 1)}
        >
          Move {isRows ? 'up' : 'left'} <kbd aria-hidden="true">Alt + arrow</kbd>
        </Button>
        <Button
          variant="ghost"
          disabled={selected.start + selected.count === info.count}
          onClick={() => move(selected.start + selected.count + 1)}
        >
          Move {isRows ? 'down' : 'right'}
        </Button>
        <form
          className="menu-field"
          onSubmit={(event) => {
            event.preventDefault();
            const target = parseIntInput(position, { min: 1, max: info.count + 1 });
            if (target !== null) move(target - 1);
          }}
        >
          <label htmlFor={`${id}-move`}>Before position</label>
          <Input
            id={`${id}-move`}
            type="number"
            min={1}
            max={info.count + 1}
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
            const pixels = parseIntInput(size, { min: MIN_SIZE[menu.axis], max: MAX_SIZE });
            if (pixels === null) return;
            run((axis, at) => ({
              type: 'resize',
              axis,
              start: at(selected.start),
              count: selected.count,
              size: pixels,
            }));
          }}
        >
          <label htmlFor={`${id}-size`}>{isRows ? 'Height' : 'Width'} (px)</label>
          <Input
            id={`${id}-size`}
            type="number"
            min={MIN_SIZE[menu.axis]}
            max={MAX_SIZE}
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
          onClick={() =>
            run((axis, at) => ({
              type: 'hide',
              axis,
              start: at(selected.start),
              count: selected.count,
            }))
          }
        >
          Hide {many}
        </Button>
        <Button
          variant="ghost"
          disabled={!info.hasHidden}
          onClick={() => run((axis) => ({ type: 'showAll', axis }))}
        >
          Show hidden {menu.axis}
        </Button>
        <Button
          variant="ghost"
          className="danger"
          disabled={!canRemove}
          title={
            canRemove ? undefined : 'Source items can be hidden; only custom items can be removed.'
          }
          onClick={() =>
            run((axis, at) => ({
              type: 'remove',
              axis,
              start: at(selected.start),
              count: selected.count,
            }))
          }
        >
          Remove custom {many}
        </Button>
        <div className="menu-note">Changes affect this view. Undo is available.</div>
      </PopoverContent>
    </Popover>
  );
}
