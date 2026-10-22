import { useEffect, useState, type RefObject } from 'react';

export interface ViewportSize {
  readonly width: number;
  readonly height: number;
}

/** Client size of the scroll container, updated on resize. */
export function useViewportSize(ref: RefObject<HTMLElement | null>): ViewportSize {
  const [size, setSize] = useState<ViewportSize>({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(() =>
      setSize({ width: element.clientWidth, height: element.clientHeight }),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}
