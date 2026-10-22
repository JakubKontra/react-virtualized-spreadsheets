import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { normalizeRange, type Address, type CellRange, type SpreadsheetStore } from '@sheet/core';

export function useRangeDrag(options: {
  store: SpreadsheetStore;
  scrollRef: RefObject<HTMLElement | null>;
  point: (x: number, y: number) => Address | undefined;
}) {
  const latest = useRef(options);
  latest.current = options;
  const current = useRef<{
    pointer: number;
    x: number;
    y: number;
    source: CellRange;
    kind: 'fill' | 'reference';
    update?: (r: CellRange) => void;
    cancel?: () => void;
  } | null>(null);
  const [preview, setPreview] = useState<CellRange | null>(null);
  const wake = useRef(() => {});
  function start(
    event: ReactPointerEvent,
    kind: 'fill' | 'reference',
    source: CellRange,
    update?: (range: CellRange) => void,
    cancel?: () => void,
  ) {
    event.preventDefault();
    event.stopPropagation();
    current.current = {
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      source: normalizeRange(source),
      kind,
      update,
      cancel,
    };
    latest.current.scrollRef.current?.setPointerCapture?.(event.pointerId);
    wake.current();
  }
  useEffect(() => {
    let frame = 0,
      range: CellRange | null = null;
    const update = () => {
      const drag = current.current,
        element = latest.current.scrollRef.current;
      if (!drag || !element) return;
      const rect = element.getBoundingClientRect();
      const speed = (p: number, a: number, b: number) =>
        p < a + 20
          ? -Math.min(24, (a + 20 - p) / 2)
          : p > b - 20
            ? Math.min(24, (p - b + 20) / 2)
            : 0;
      element.scrollLeft += speed(drag.x, rect.left, rect.right);
      element.scrollTop += speed(drag.y, rect.top, rect.bottom);
      const point = latest.current.point(drag.x, drag.y);
      if (point) {
        const s = drag.source;
        if (drag.kind === 'reference') range = normalizeRange({ start: s.start, end: point });
        else {
          const dr = Math.max(s.start.row - point.row, point.row - s.end.row, 0),
            dc = Math.max(s.start.col - point.col, point.col - s.end.col, 0);
          range =
            dr >= dc
              ? {
                  start: { row: Math.min(s.start.row, point.row), col: s.start.col },
                  end: { row: Math.max(s.end.row, point.row), col: s.end.col },
                }
              : {
                  start: { row: s.start.row, col: Math.min(s.start.col, point.col) },
                  end: { row: s.end.row, col: Math.max(s.end.col, point.col) },
                };
        }
        setPreview((previous) =>
          JSON.stringify(previous) === JSON.stringify(range) ? previous : range,
        );
        drag.update?.(range);
      }
      frame = requestAnimationFrame(update);
    };
    const finish = (cancel: boolean) => {
      const drag = current.current;
      if (!drag) return;
      if (!cancel) {
        cancelAnimationFrame(frame);
        update();
      }
      current.current = null;
      cancelAnimationFrame(frame);
      frame = 0;
      setPreview(null);
      const element = latest.current.scrollRef.current;
      if (element?.hasPointerCapture?.(drag.pointer)) element.releasePointerCapture(drag.pointer);
      if (cancel) drag.cancel?.();
      else if (drag.kind === 'fill' && range)
        void latest.current.store
          .fill(range, drag.source)
          .catch((e) => latest.current.store.setError(e));
      range = null;
    };
    const move = (e: PointerEvent) => {
      if (current.current?.pointer === e.pointerId) {
        current.current.x = e.clientX;
        current.current.y = e.clientY;
      }
    };
    const up = (e: PointerEvent) => {
      if (current.current?.pointer === e.pointerId) {
        move(e);
        finish(false);
      }
    };
    const cancel = () => finish(true);
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && current.current) {
        e.preventDefault();
        e.stopImmediatePropagation();
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
      current.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', key, true);
    };
  }, []);
  return { start, preview };
}
