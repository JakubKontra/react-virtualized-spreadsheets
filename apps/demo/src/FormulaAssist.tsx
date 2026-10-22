import { useLayoutEffect, useRef, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { useSpreadsheet } from '@sheet/react';

type Sheet = ReturnType<typeof useSpreadsheet>;
const margin = 8;
const gap = 4;

export function FormulaAssist({
  id,
  sheet,
  anchorRef,
  scrollRef,
}: {
  id: string;
  sheet: Sheet;
  anchorRef: RefObject<HTMLInputElement | null>;
  scrollRef: RefObject<HTMLDivElement | null>;
}) {
  const popupRef = useRef<HTMLDivElement>(null);
  const latest = useRef(sheet);
  const reposition = useRef<(() => void) | null>(null);

  // Read the committed virtualizer positions, including pinned cells, before paint.
  useLayoutEffect(() => {
    latest.current = sheet;
    reposition.current?.();
  });

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const popup = popupRef.current;
    const grid = scrollRef.current;
    if (!anchor || !popup || !grid) return;
    let frame = 0;

    const update = () => {
      const { state, frozenRows, frozenColumns, virtualRows, virtualColumns } = latest.current;
      const viewport = window.visualViewport;
      const left = (viewport?.offsetLeft ?? 0) + margin;
      const top = (viewport?.offsetTop ?? 0) + margin;
      const right = left + (viewport?.width ?? document.documentElement.clientWidth) - margin * 2;
      const bottom = top + (viewport?.height ?? window.innerHeight) - margin * 2;
      const rect = anchor.getBoundingClientRect();
      let visibleLeft = left,
        visibleTop = top,
        visibleRight = right,
        visibleBottom = bottom;

      if (state.editor === 'cell' && state.editing) {
        const bounds = grid.getBoundingClientRect();
        const corner = grid.querySelector('.corner')!.getBoundingClientRect();
        // An ordinary cell can scroll behind either pinned pane or the headers.
        const rowEdge =
          state.editing.row >= frozenRows
            ? virtualRows.find((row) => row.index === frozenRows - 1)?.end
            : undefined;
        const columnEdge =
          state.editing.col >= frozenColumns
            ? virtualColumns.find((col) => col.index === frozenColumns - 1)?.end
            : undefined;
        visibleLeft = Math.max(
          left,
          columnEdge === undefined ? corner.right : bounds.left + grid.clientLeft + columnEdge,
        );
        visibleTop = Math.max(
          top,
          rowEdge === undefined ? corner.bottom : bounds.top + grid.clientTop + rowEdge,
        );
        visibleRight = Math.min(right, bounds.left + grid.clientLeft + grid.clientWidth);
        visibleBottom = Math.min(bottom, bounds.top + grid.clientTop + grid.clientHeight);
      }

      if (
        rect.right <= visibleLeft ||
        rect.left >= visibleRight ||
        rect.bottom <= visibleTop ||
        rect.top >= visibleBottom
      ) {
        popup.style.visibility = 'hidden';
        return;
      }

      popup.style.maxWidth = `${Math.max(0, right - left)}px`;
      const width = popup.getBoundingClientRect().width;
      const naturalHeight = popup.scrollHeight + popup.offsetHeight - popup.clientHeight;
      const below = Math.max(0, bottom - rect.bottom - gap);
      const above = Math.max(0, rect.top - gap - top);
      const flip = below < Math.min(240, naturalHeight) && above > below;
      const maxHeight = Math.min(240, flip ? above : below);
      const height = Math.min(naturalHeight, maxHeight);
      popup.style.left = `${Math.max(left, Math.min(rect.left, right - width))}px`;
      popup.style.top = `${flip ? rect.top - gap - height : rect.bottom + gap}px`;
      popup.style.maxHeight = `${maxHeight}px`;
      popup.style.visibility = maxHeight > 0 ? 'visible' : 'hidden';
    };
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        update();
      });
    };

    reposition.current = update;
    update();
    const observer = new ResizeObserver(schedule);
    observer.observe(anchor);
    observer.observe(popup);
    observer.observe(grid);
    // Capture nested grid scrolling as well as page scrolling; at most one read per frame.
    window.addEventListener('scroll', schedule, { capture: true, passive: true });
    window.addEventListener('resize', schedule);
    const viewport = window.visualViewport;
    viewport?.addEventListener('resize', schedule);
    viewport?.addEventListener('scroll', schedule);
    return () => {
      reposition.current = null;
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      viewport?.removeEventListener('resize', schedule);
      viewport?.removeEventListener('scroll', schedule);
    };
  }, [anchorRef, scrollRef]);

  const { formula } = sheet;
  return createPortal(
    <div
      id={id}
      ref={popupRef}
      className="formula-assist"
      onPointerDown={(event) => event.preventDefault()}
    >
      {formula.suggestions.length > 0 && (
        <div role="listbox" aria-label="Formula functions">
          {formula.suggestions.map((item, i) => (
            <button
              key={item.name}
              type="button"
              role="option"
              tabIndex={-1}
              aria-selected={i === formula.selected}
              onClick={() => formula.accept(i)}
            >
              <strong>{item.name}</strong> {item.description}
            </button>
          ))}
        </div>
      )}
      {formula.help && (
        <span>
          {formula.help.signature} · argument {formula.help.argument}
        </span>
      )}
      {formula.references.length > 0 && (
        <div className="formula-references">
          {formula.references.map((ref, i) => (
            <span key={i} style={{ color: ref.color }}>
              {ref.label}
            </span>
          ))}
        </div>
      )}
      <small>
        Type a function, or click and drag cells after an operator to insert a reference.
      </small>
    </div>,
    document.body,
  );
}
