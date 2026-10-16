"use client";

// Small localStorage store for useSyncExternalStore.
// Data lives in this browser only. It does not sync across devices or users.
// Nothing sensitive is stored here.

export const EVENTS_KEY = "metaforge-calendar-events";
export const FAVORITES_KEY = "metaforge-calendar-favorites";

const listeners = new Set<() => void>();

export function subscribeStore(callback: () => void): () => void {
  listeners.add(callback);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === EVENTS_KEY || event.key === FAVORITES_KEY) {
      callback();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", onStorage);
  };
}

export function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Returns false when the browser blocks or fills up storage. */
export function writeRaw(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    return false;
  }
  listeners.forEach((listener) => listener());
  return true;
}