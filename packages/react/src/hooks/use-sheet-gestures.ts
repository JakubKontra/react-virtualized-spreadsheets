import { useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import {
  Address,
  type Axis,
  type AxisIndex,
  type SpreadsheetState,
  type SpreadsheetStore,
  type ViewChange,
} from '@sheet/core';
import { axisIndex, coordinate, spanChange } from '../internal/axis';
import type { AxisItem } from '../internal/geometry';
import type { AxisSelection, DragPreview, HeaderMenu, SheetGestures } from '../types';
import { useLatest } from './use-stable-callback';

export interface UseSheetGesturesOptions {
  readonly store: SpreadsheetStore;
  readonly scrollRef: RefObject<HTMLElement | null>;
  readonly rowHeaderWidth: number;
  readonly columnHeaderHeight: number;
  /** Commits a pending edit; resolves `false` when it failed. */
  commit(): Promise<boolean>;
  /** Content position of a visible item. */
  item(axis: Axis, index: number): AxisItem;
  /** Rendered item at a content offset. */
  itemAt(axis: Axis, offset: number): AxisItem | undefined;
  /** Content offset of a viewport-local point, accounting for frozen panes. */
  offset(axis: Axis, local: number): number;
  /** Rendered offset of an item that starts at `start`. */
  display(axis: Axis, index: number, start: number): number;
}

type GestureKind = 'selection' | 'move' | 'resize';
interface Gesture {
  readonly kind: GestureKind;
  readonly axis: Axis;
  readonly start: number;
  readonly count: number;
  before: number;
  readonly initialSize: number;
  size: number;
  x: number;
  y: number;
  readonly originX: number;
  readonly originY: number;
  active: boolean;
  readonly pointer: number;
  readonly previous: SpreadsheetState;
}

const DRAG_THRESHOLD = 5;
const MIN_SIZE: Readonly<Record<Axis, number>> = { rows: 24, columns: 48 };
const MAX_SIZE = 2000;
const RESIZE_STEP = 8;
const ARROWS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
const isBackward = (key: string) => key === 'ArrowLeft' || key === 'ArrowUp';
const itemName = (axis: Axis) => (axis === 'rows' ? 'row' : 'column');

export function useSheetGestures(options: UseSheetGesturesOptions): SheetGestures {
  const latest = useLatest(options);
  const gesture = useRef<Gesture | null>(null);
  const wake = useRef<() => void>(() => {});
  const [preview, setPreview] = useState<DragPreview | null>(null);
  const [menu, setMenu] = useState<HeaderMenu | null>(null);
  const [announcement, announce] = useState('');
  const focus = () => latest.current.scrollRef.current?.focus({ preventScroll: true });
  function selection(axis: Axis, index: number): AxisSelection {
    const state = latest.current.store.getSnapshot();
    const key = coordinate(axis);
    const start = Math.min(state.selection.start[key], state.selection.end[key]);
    const end = Math.max(state.selection.start[key], state.selection.end[key]);
    return state.selectionKind === axis && index >= start && index <= end
      ? { start, count: end - start + 1 }
      : { start: index, count: 1 };
  }
  const selectAxis = (axis: Axis, index: number, extend = false) =>
    latest.current.store.selectAxis(axis, axisIndex(axis, index), extend);
  async function run(change: ViewChange) {
    if (!(await latest.current.commit())) return false;
    try {
      latest.current.store.changeView(change);
      setMenu(null);
      announce(`${change.type === 'showAll' ? 'Restored' : change.type} ${change.axis}`);
      focus();
      return true;
    } catch (error) {
      latest.current.store.setError(error);
      return false;
    }
  }
  async function openMenu<X extends Axis>(axis: X, index: AxisIndex<X>, x: number, y: number) {
    if (!(await latest.current.commit())) return;
    if (selection(axis, index).count === 1) selectAxis(axis, index);
    const position = {
      x: Math.max(8, Math.min(x, window.innerWidth - 258)),
      y: Math.max(8, Math.min(y, window.innerHeight - 420)),
    };
    setMenu(
      axis === 'rows'
        ? { axis: 'rows', index: axisIndex('rows', index), ...position }
        : { axis: 'columns', index: axisIndex('columns', index), ...position },
    );
  }
  function start(event: PointerEvent, kind: GestureKind, axis: Axis = 'rows', index = 0) {
    if (event.button !== 0 || !latest.current.scrollRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    const store = latest.current.store;
    if (store.getSnapshot().editing) {
      void latest.current.commit().then((ok) => {
        if (ok && kind !== 'selection') selectAxis(axis, index, event.shiftKey);
      });
      return;
    }
    if (kind === 'move' && event.shiftKey) {
      selectAxis(axis, index, true);
      focus();
      return;
    }
    const selected = kind === 'selection' ? { start: index, count: 1 } : selection(axis, index);
    if (kind !== 'selection' && selected.count === 1) selectAxis(axis, index);
    const size = latest.current.item(axis, index).size;
    gesture.current = {
      kind,
      axis,
      ...selected,
      before: selected.start,
      initialSize: size,
      size,
      x: event.clientX,
      y: event.clientY,
      originX: event.clientX,
      originY: event.clientY,
      active: kind === 'selection',
      pointer: event.pointerId,
      previous: store.getSnapshot(),
    };
    if (kind !== 'selection') latest.current.scrollRef.current.setPointerCapture?.(event.pointerId);
    wake.current();
    setMenu(null);
    focus();
  }
  useEffect(() => {
    let frame = 0;
    const update = () => {
      const current = gesture.current;
      const opts = latest.current;
      const element = opts.scrollRef.current;
      if (current && element) {
        current.active ||=
          Math.hypot(current.x - current.originX, current.y - current.originY) >= DRAG_THRESHOLD;
        if (current.active) {
          const rect = element.getBoundingClientRect();
          const speed = (point: number, start: number, end: number) =>
            point < start + 32
              ? -Math.min(24, (start + 32 - point) * 0.75)
              : point > end - 32
                ? Math.min(24, (point - end + 32) * 0.75)
                : 0;
          if (current.kind !== 'resize') {
            if (current.kind === 'selection' || current.axis === 'columns')
              element.scrollLeft += speed(current.x, rect.left + opts.rowHeaderWidth, rect.right);
            if (current.kind === 'selection' || current.axis === 'rows')
              element.scrollTop += speed(
                current.y,
                rect.top + opts.columnHeaderHeight,
                rect.bottom,
              );
          }
          const x = opts.offset(
            'columns',
            Math.max(opts.rowHeaderWidth, Math.min(rect.width - 1, current.x - rect.left)),
          );
          const y = opts.offset(
            'rows',
            Math.max(opts.columnHeaderHeight, Math.min(rect.height - 1, current.y - rect.top)),
          );
          if (current.kind === 'selection') {
            const row = opts.itemAt('rows', y)?.index;
            const col = opts.itemAt('columns', x)?.index;
            if (row !== undefined && col !== undefined) {
              const end = opts.store.getSnapshot().selection.end;
              if (end.row !== row || end.col !== col)
                opts.store.select(Address.unsafe(row, col), true);
            }
          } else {
            const horizontal = current.axis === 'columns';
            const point = horizontal ? x : y;
            const item = opts.itemAt(current.axis, point);
            if (item) current.before = item.index + (point >= item.start + item.size / 2 ? 1 : 0);
            current.size = Math.round(
              Math.max(
                MIN_SIZE[current.axis],
                Math.min(
                  MAX_SIZE,
                  current.initialSize +
                    (horizontal ? current.x - current.originX : current.y - current.originY),
                ),
              ),
            );
            const count = horizontal ? opts.store.columns : opts.store.rows;
            const boundary =
              current.kind === 'resize'
                ? opts.item(current.axis, current.start).start + current.size
                : current.before >= count
                  ? opts.item(current.axis, count - 1).end
                  : opts.item(current.axis, current.before).start;
            const edge =
              opts.display(
                current.axis,
                current.kind === 'resize' ? current.start : current.before,
                boundary,
              ) - (horizontal ? element.scrollLeft : element.scrollTop);
            const line = horizontal
              ? { left: rect.left + edge, top: rect.top, width: 2, height: rect.height }
              : { left: rect.left, top: rect.top + edge, width: rect.width, height: 2 };
            const { kind, axis, start, count: span, before, size } = current;
            setPreview({
              kind,
              axis,
              start,
              count: span,
              before,
              size,
              x: current.x,
              y: current.y,
              line,
            });
          }
        }
      }
      frame = gesture.current ? requestAnimationFrame(update) : 0;
    };
    const move = (event: globalThis.PointerEvent) => {
      if (gesture.current?.pointer === event.pointerId) {
        gesture.current.x = event.clientX;
        gesture.current.y = event.clientY;
      }
    };
    const finish = (cancel: boolean) => {
      const current = gesture.current;
      if (!current) return;
      gesture.current = null;
      setPreview(null);
      const element = latest.current.scrollRef.current;
      if (element?.hasPointerCapture?.(current.pointer))
        element.releasePointerCapture(current.pointer);
      if (!cancel && current.active && current.kind !== 'selection')
        void run(
          spanChange(
            current.axis,
            current,
            current.kind === 'move'
              ? { type: 'move', before: current.before }
              : { type: 'resize', size: current.size },
          ),
        );
      if (cancel && current.kind === 'selection') {
        latest.current.store.select(current.previous.selection.start);
        latest.current.store.select(current.previous.selection.end, true);
      }
    };
    const up = (event: globalThis.PointerEvent) => {
      if (gesture.current?.pointer === event.pointerId) {
        gesture.current.x = event.clientX;
        gesture.current.y = event.clientY;
        cancelAnimationFrame(frame);
        update();
        finish(false);
        cancelAnimationFrame(frame);
        frame = 0;
      }
    };
    const cancel = () => finish(true);
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && gesture.current) {
        event.preventDefault();
        finish(true);
      }
    };
    wake.current = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', key, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', key, true);
      gesture.current = null;
    };
    // `run` only reads `latest`; the listeners are installed once.
  }, [latest]);
  // Prop getters run during render: read this render's options, not `latest` (updated after commit).
  const headerProps: SheetGestures['headerProps'] = (axis, index) => {
    const state = options.store.getSnapshot();
    const key = coordinate(axis);
    const isSelected =
      state.selectionKind === axis &&
      index >= Math.min(state.selection.start[key], state.selection.end[key]) &&
      index <= Math.max(state.selection.start[key], state.selection.end[key]);
    return {
      'aria-selected': isSelected,
      onPointerDown(event) {
        if (event.button !== 0) return;
        event.preventDefault();
        const extend = event.shiftKey;
        void latest.current.commit().then((ok) => {
          if (ok) {
            selectAxis(axis, index, extend);
            focus();
          }
        });
      },
      onContextMenu(event) {
        event.preventDefault();
        void openMenu(axis, index, event.clientX, event.clientY);
      },
    };
  };
  const dragProps: SheetGestures['dragProps'] = (axis, index) => ({
    'aria-label': `Move ${itemName(axis)} ${index + 1}`,
    onPointerDown: (event) => start(event, 'move', axis, index),
    onKeyDown(event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        void openMenu(axis, index, rect.left, rect.bottom);
      } else if (event.altKey && ARROWS.includes(event.key)) {
        event.preventDefault();
        const selected = selection(axis, index);
        const count = axis === 'rows' ? latest.current.store.rows : latest.current.store.columns;
        const target = isBackward(event.key)
          ? selected.start - 1
          : selected.start + selected.count + 1;
        void run(
          spanChange(axis, selected, {
            type: 'move',
            before: Math.max(0, Math.min(count, target)),
          }),
        );
      }
    },
  });
  const resizeProps: SheetGestures['resizeProps'] = (axis, index) => ({
    role: 'separator',
    tabIndex: 0,
    'aria-valuemin': MIN_SIZE[axis],
    'aria-valuemax': MAX_SIZE,
    'aria-valuenow': options.item(axis, index).size,
    'aria-orientation': axis === 'columns' ? 'vertical' : 'horizontal',
    'aria-label': `Resize ${itemName(axis)} ${index + 1}`,
    onPointerDown: (event) => start(event, 'resize', axis, index),
    onKeyDown(event) {
      if (ARROWS.includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        const delta = isBackward(event.key) ? -RESIZE_STEP : RESIZE_STEP;
        void run(
          spanChange(axis, selection(axis, index), {
            type: 'resize',
            size: latest.current.item(axis, index).size + delta,
          }),
        );
      }
    },
  });
  return {
    preview,
    menu,
    announcement,
    closeMenu: () => setMenu(null),
    openMenu,
    run,
    selection,
    headerProps,
    dragProps,
    resizeProps,
    startSelection: (event) => start(event, 'selection'),
  };
}
