import type { KeyboardEvent } from 'react';

const NAVIGATION_KEYS = ['ArrowDown', 'ArrowUp', 'Home', 'End'] as const;
type NavigationKey = (typeof NAVIGATION_KEYS)[number];
const isNavigationKey = (key: string): key is NavigationKey =>
  NAVIGATION_KEYS.some((candidate) => candidate === key);

function targetIndex(key: NavigationKey, index: number, length: number): number {
  switch (key) {
    case 'Home':
      return 0;
    case 'End':
      return length - 1;
    case 'ArrowDown':
      return (index + 1) % length;
    case 'ArrowUp':
      return (index - 1 + length) % length;
  }
}

/** Roving focus between the enabled buttons of a menu with arrows, Home and End. */
export function moveMenuFocus(event: KeyboardEvent<HTMLElement>, menu: HTMLElement | null): void {
  if (!menu || !isNavigationKey(event.key) || !(event.target instanceof HTMLButtonElement)) return;
  event.preventDefault();
  const items = [...menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
  items[targetIndex(event.key, items.indexOf(event.target), items.length)]?.focus();
}
