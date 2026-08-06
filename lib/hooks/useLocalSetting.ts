"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * A per-browser view preference — page size, which optional columns to show.
 *
 * These are choices about how somebody reads a list, not data, so they live in
 * localStorage rather than the database: they belong to the person at the
 * screen and should not follow them to a shared machine or need a round trip.
 *
 * The stored value is read **after** mount, never during render. Reading it in
 * the initial state would make the server's HTML and the client's first render
 * disagree whenever a preference was saved, which React reports as a hydration
 * mismatch.
 */
export function useLocalSetting<T>(
  key: string,
  fallback: T,
  /** Rejects anything stored under this key that is no longer valid. */
  /**
   * Rejects anything stored under this key that is no longer valid. Omit it
   * and whatever was stored is taken at face value.
   */
  isValid?: (value: unknown) => value is T,
): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(fallback);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(key);
      if (stored === null) return;

      const parsed: unknown = JSON.parse(stored);
      if (!isValid || isValid(parsed)) setValue(parsed as T);
    } catch {
      // A corrupt or unreadable entry is not worth failing a page over.
    }
    // `isValid` is a literal at every call site; re-running on its identity
    // would reset the value on each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const update = useCallback(
    (next: T) => {
      setValue(next);

      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Private browsing and full quotas both throw; the choice still
        // applies for this session.
      }
    },
    [key],
  );

  return [value, update];
}

/** Guard for a stored boolean — the common case for a column toggle. */
export function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}
