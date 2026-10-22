import {
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import type { Axis, SpreadsheetStore, ViewChange } from '@sheet/core';

interface Item {
  index: number;
  start: number;
  size: number;
  end: number;
}
interface Options {
  store: SpreadsheetStore;
  scrollRef: RefObject<HTMLElement | null>;
  itemAt: (axis: Axis, offset: number) => Item | undefined;
  item: (axis: Axis, index: number) => Item;
  rowHeaderWidth: number;
  columnHeaderHeight: number;
  commit: () => Promise<boolean>;
  offset: (axis: Axis, local: number) => number;
  display: (axis: Axis, index: number, start: number) => number;
}
export interface HeaderMenu {
  axis: Axis;
  index: number;
  x: number;
  y: number;
}
export interface DragPreview {
  kind: 'move' | 'resize';
  axis: Axis;
  start: number;
  count: number;
  before: number;
  size: number;
  x: number;
  y: number;
  line: { left: number; top: number; width: number; height: number };
}
interface Gesture {
  kind: 'selection' | 'move' | 'resize';
  axis: Axis;
  start: number;
  count: number;
  before: number;
  initialSize: number;
  size: number;
  x: number;
  y: number;
  originX: number;
  originY: number;
  active: boolean;
  pointer: number;
  previous: ReturnType<SpreadsheetStore['getSnapshot']>;
}

export function useSheetGestures(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const gesture = useRef<Gesture | null>(null);
  const wake = useRef<() => void>(() => {});
  const [preview, setPreview] = useState<DragPreview | null>(null);
  const [menu, setMenu] = useState<HeaderMenu | null>(null);
  const [announcement, announce] = useState('');
  const focus = () => latest.current.scrollRef.current?.focus({ preventScroll: true });
  function selection(axis: Axis, index: number) {
    const state = latest.current.store.getSnapshot();
    const key = axis === 'rows' ? 'row' : 'col';
    const start = Math.min(state.selection.start[key], state.selection.end[key]);
    const end = Math.max(state.selection.start[key], state.selection.end[key]);
    return state.selectionKind === axis && index >= start && index <= end
      ? { start, count: end - start + 1 }
      : { start: index, count: 1 };
  }
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
  async function openMenu(axis: Axis, index: number, x: number, y: number) {
    if (!(await latest.current.commit())) return;
    const selected = selection(axis, index);
    if (selected.count === 1) latest.current.store.selectAxis(axis, index);
    setMenu({
      axis,
      index,
      x: Math.max(8, Math.min(x, window.innerWidth - 258)),
      y: Math.max(8, Math.min(y, window.innerHeight - 420)),
    });
  }
  function start(event: ReactPointerEvent, kind: Gesture['kind'], axis: Axis = 'rows', index = 0) {
    if (event.button !== 0 || !latest.current.scrollRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    const store = latest.current.store;
    if (store.getSnapshot().editing) {
      void latest.current.commit().then((ok) => {
        if (ok && kind !== 'selection') store.selectAxis(axis, index, event.shiftKey);
      });
      return;
    }
    if (kind === 'move' && event.shiftKey) {
      store.selectAxis(axis, index, true);
      focus();
      return;
    }
    const selected = kind === 'selection' ? { start: index, count: 1 } : selection(axis, index);
    if (kind !== 'selection' && selected.count === 1) store.selectAxis(axis, index);
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
          Math.hypot(current.x - current.originX, current.y - current.originY) >= 5;
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
              if (end.row !== row || end.col !== col) opts.store.select({ row, col }, true);
            }
          } else {
            const horizontal = current.axis === 'columns';
            const point = horizontal ? x : y;
            const item = opts.itemAt(current.axis, point);
            if (item) current.before = item.index + (point >= item.start + item.size / 2 ? 1 : 0);
            current.size = Math.round(
              Math.max(
                horizontal ? 48 : 24,
                Math.min(
                  2000,
                  current.initialSize +
                    (horizontal ? current.x - current.originX : current.y - current.originY),
                ),
              ),
            );
            const boundary =
              current.kind === 'resize'
                ? opts.item(current.axis, current.start).start + current.size
                : current.before >= (horizontal ? opts.store.columns : opts.store.rows)
                  ? opts.item(current.axis, (horizontal ? opts.store.columns : opts.store.rows) - 1)
                      .end
                  : opts.item(current.axis, current.before).start;
            const line = horizontal
              ? {
                  left:
                    rect.left +
                    opts.display(
                      current.axis,
                      current.kind === 'resize' ? current.start : current.before,
                      boundary,
                    ) -
                    element.scrollLeft,
                  top: rect.top,
                  width: 2,
                  height: rect.height,
                }
              : {
                  left: rect.left,
                  top:
                    rect.top +
                    opts.display(
                      current.axis,
                      current.kind === 'resize' ? current.start : current.before,
                      boundary,
                    ) -
                    element.scrollTop,
                  width: rect.width,
                  height: 2,
                };
            setPreview({ ...current, kind: current.kind, line });
          }
        }
      }
      frame = gesture.current ? requestAnimationFrame(update) : 0;
    };
    const move = (event: PointerEvent) => {
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
          current.kind === 'move'
            ? {
                type: 'move',
                axis: current.axis,
                start: current.start,
                count: current.count,
                before: current.before,
              }
            : {
                type: 'resize',
                axis: current.axis,
                start: current.start,
                count: current.count,
                size: current.size,
              },
        );
      if (cancel && current.kind === 'selection') {
        latest.current.store.select(current.previous.selection.start);
        latest.current.store.select(current.previous.selection.end, true);
      }
    };
    const up = (event: PointerEvent) => {
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
  }, []);
  function headerProps(axis: Axis, index: number): HTMLAttributes<HTMLElement> {
    const state = latest.current.store.getSnapshot();
    const key = axis === 'rows' ? 'row' : 'col';
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
            latest.current.store.selectAxis(axis, index, extend);
            focus();
          }
        });
      },
      onContextMenu(event) {
        event.preventDefault();
        void openMenu(axis, index, event.clientX, event.clientY);
      },
    };
  }
  function dragProps(axis: Axis, index: number): HTMLAttributes<HTMLElement> {
    return {
      'aria-label': `Move ${axis === 'rows' ? 'row' : 'column'} ${index + 1}`,
      onPointerDown: (event) => start(event, 'move', axis, index),
      onKeyDown(event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          void openMenu(axis, index, rect.left, rect.bottom);
        } else if (
          event.altKey &&
          ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
        ) {
          event.preventDefault();
          const selected = selection(axis, index);
          const delta = ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1;
          void run({
            type: 'move',
            axis,
            ...selected,
            before: Math.max(
              0,
              Math.min(
                axis === 'rows' ? latest.current.store.rows : latest.current.store.columns,
                delta < 0 ? selected.start - 1 : selected.start + selected.count + 1,
              ),
            ),
          });
        }
      },
    };
  }
  function resizeProps(axis: Axis, index: number): HTMLAttributes<HTMLElement> {
    return {
      role: 'separator',
      tabIndex: 0,
      'aria-valuemin': axis === 'rows' ? 24 : 48,
      'aria-valuemax': 2000,
      'aria-valuenow': latest.current.item(axis, index).size,
      'aria-orientation': axis === 'columns' ? 'vertical' : 'horizontal',
      'aria-label': `Resize ${axis === 'rows' ? 'row' : 'column'} ${index + 1}`,
      onPointerDown: (event) => start(event, 'resize', axis, index),
      onKeyDown(event) {
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
          event.preventDefault();
          event.stopPropagation();
          const delta = ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -8 : 8;
          void run({
            type: 'resize',
            axis,
            ...selection(axis, index),
            size: latest.current.item(axis, index).size + delta,
          });
        }
      },
    };
  }
  return {
    preview,
    menu,
    announcement,
    setMenu,
    openMenu,
    run,
    selection,
    headerProps,
    dragProps,
    resizeProps,
    startSelection: (event: ReactPointerEvent) => start(event, 'selection'),
  };
}
