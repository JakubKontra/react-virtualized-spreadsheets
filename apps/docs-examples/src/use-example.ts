import { useEffect, useState } from 'react';
import type { SpreadsheetStore } from '@sheet/core';

// Pass a stable module-level factory. Every effect setup owns fresh stores.
export function useExample(create: () => SpreadsheetStore[]) {
  const [stores, setStores] = useState<SpreadsheetStore[] | null>(null);
  useEffect(() => {
    const instances = create();
    setStores(instances);
    return () => instances.forEach((store) => store.dispose());
  }, [create]);
  return stores;
}
