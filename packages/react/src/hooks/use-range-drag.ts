import { useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import { CellRange, type Address, type SpreadsheetStore } from '@sheet/core';
import { fillTarget } from '../internal/fill';
import { useLatest } from './use-stable-callback';

/** What a range drag does with the covered range. */
export type RangeDragRequest =
  /** Extend the source with the fill handle; fills on release. */
  | { readonly kind: 'fill'; readonly source: CellRange }
  /** Point at cells to insert a reference into a formula draft. */
  | {
      readonly kind: 'reference';
      readonly source: CellRange;
      update(range: CellRange): void;
      cancel(): void;
    };

interface Drag {
  readonly request: RangeDragRequest;
  readonly pointer: number;
  x: number;
  y: number;
}

export interface UseRangeDragOptions {
  readonly store: SpreadsheetStore;
  readonly scrollRef: RefObject<HTMLElement | null>;
  /** Cell under a client point, if any. */
  readonly point: (x: number, y: number) => Address | undefined;
}
export interface RangeDrag {
  start(event: PointerEvent, request: RangeDragRequest): void;
  readonly preview: CellRange | null;
}

const EDGE = 20;
const MAX_SPEED = 24;

export function useRangeDrag(options: UseRangeDragOptions): RangeDrag {
  const latest = useLatest(options);
  const current = useRef<Drag | null>(null);
  const [preview, setPreview] = useState<CellRange | null>(null);
  const wake = useRef(() => {});
  function start(event: PointerEvent, request: RangeDragRequest) {
    event.preventDefault();
    event.stopPropagation();
    current.current = {
      request: { ...request, source: CellRange.normalize(request.source) },
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
    latest.current.scrollRef.current?.setPointerCapture?.(event.pointerId);
    wake.current();
  }
  useEffect(() => {
    let frame = 0;
    let range: CellRange | null = null;
    const update = () => {
      const drag = current.current;
      const element = latest.current.scrollRef.current;
      if (!drag || !element) return;
      const rect = element.getBoundingClientRect();
      const speed = (p: number, a: number, b: number) =>
        p < a + EDGE
          ? -Math.min(MAX_SPEED, (a + EDGE - p) / 2)
          : p > b - EDGE
            ? Math.min(MAX_SPEED, (p - b + EDGE) / 2)
            : 0;
      element.scrollLeft += speed(drag.x, rect.left, rect.right);
      element.scrollTop += speed(drag.y, rect.top, rect.bottom);
      const point = latest.current.point(drag.x, drag.y);
      if (point) {
        const { request } = drag;
        const next =
          request.kind === 'reference'
            ? CellRange.normalize(CellRange.of(request.source.start, point))
            : fillTarget(request.source, point);
        range = next;
        setPreview((previous) => (previous && CellRange.equals(previous, next) ? previous : next));
        if (request.kind === 'reference') request.update(next);
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
      const { request } = drag;
      if (cancel) {
        if (request.kind === 'reference') request.cancel();
      } else if (request.kind === 'fill' && range) {
        const { store } = latest.current;
        store.fill(range, request.source).catch((error: unknown) => store.setError(error));
      }
      range = null;
    };
    const move = (event: globalThis.PointerEvent) => {
      if (current.current?.pointer === event.pointerId) {
        current.current.x = event.clientX;
        current.current.y = event.clientY;
      }
    };
    const up = (event: globalThis.PointerEvent) => {
      if (current.current?.pointer === event.pointerId) {
        move(event);
        finish(false);
      }
    };
    const cancel = () => finish(true);
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && current.current) {
        event.preventDefault();
        event.stopImmediatePropagation();
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
  }, [latest]);
  return { start, preview };
}
