import { useEffect, useState } from 'react';
import type { SpreadsheetStore } from '@sheet/core';

/**
 * Owns the stores of one example. Pass a stable module-level factory returning a tuple, so that
 * `stores[0]` is typed as a store rather than `SpreadsheetStore | undefined`.
 * Every effect setup owns fresh stores.
 */
export function useExample<const T extends readonly SpreadsheetStore[]>(create: () => T): T | null {
  const [stores, setStores] = useState<T | null>(null);
  useEffect(() => {
    const instances = create();
    setStores(instances);
    return () => instances.forEach((store) => store.dispose());
  }, [create]);
  return stores;
}
