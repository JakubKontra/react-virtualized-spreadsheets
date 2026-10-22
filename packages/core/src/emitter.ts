export type Unsubscribe = () => void;
export type Listener<T> = (value: T) => void;

/** A typed listener set. */
export class Emitter<T = void> {
  private listeners = new Set<Listener<T>>();
  subscribe = (listener: Listener<T>): Unsubscribe => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  emit(value: T) {
    for (const listener of [...this.listeners]) listener(value);
  }
  get size() {
    return this.listeners.size;
  }
  clear() {
    this.listeners.clear();
  }
}

/** Listener sets addressed by key, used for per-cell subscriptions. */
export class KeyedEmitter<K> {
  private listeners = new Map<K, Set<() => void>>();
  subscribe(key: K, listener: () => void): Unsubscribe {
    let set = this.listeners.get(key);
    if (!set) this.listeners.set(key, (set = new Set()));
    set.add(listener);
    return () => {
      set.delete(listener);
      if (!set.size) this.listeners.delete(key);
    };
  }
  emit(keys: Iterable<K>) {
    for (const key of keys) this.listeners.get(key)?.forEach((listener) => listener());
  }
  clear() {
    this.listeners.clear();
  }
}
