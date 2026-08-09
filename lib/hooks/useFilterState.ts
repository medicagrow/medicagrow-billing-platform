"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  filterQuery,
  mergeFilterParams,
  parseFilters,
  type FilterShape,
} from "@/lib/filter-params";

/**
 * List filters that live in the URL.
 *
 * A filtered list is a place, not a mood. Opening a claim and pressing back
 * used to drop every filter, because the filters were React state and React
 * state does not survive a navigation. Putting them in the query string makes
 * the browser restore them for free — and makes a filtered view something that
 * can be bookmarked or sent to somebody.
 *
 * Three rules the implementation follows:
 *
 *  - **`replace`, never `push`.** Typing into a search box would otherwise
 *    stack one history entry per keystroke, and "back" would walk through them
 *    rather than leaving the page.
 *  - **Local state renders; the URL follows.** Deriving the inputs straight
 *    from `useSearchParams()` would make every keystroke wait out a debounce
 *    before appearing on screen.
 *  - **Only declared keys are touched.** The top bar's practice selector, and
 *    anything else already in the query string, is carried through untouched.
 *
 * The encoding itself lives in [lib/filter-params.ts](lib/filter-params.ts).
 */

export interface FilterStateOptions<T extends FilterShape> {
  /**
   * Keys whose updates are debounced before reaching the URL — the free-text
   * boxes. Everything else lands at once, because a dropdown produces a single
   * change and the person expects to see its effect.
   */
  debounced?: (keyof T)[];
  /** Milliseconds to wait on a debounced key. */
  debounceMs?: number;
  /**
   * The key holding the page number, if there is one. Changing any *other*
   * filter sends it back to its default: staying on page 7 of a result set
   * that just became three pages long shows an empty table.
   */
  pageKey?: keyof T;
}

export function useFilterState<T extends FilterShape>(
  defaults: T,
  options: FilterStateOptions<T> = {},
): [T, (updates: Partial<T>) => void, () => void] {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const { debounced = [], debounceMs = 300, pageKey } = options;

  /**
   * `defaults` is written inline at every call site, so it is a fresh object
   * on every render. Holding the first one keeps the callbacks below stable.
   */
  const defaultsRef = useRef(defaults);

  const [state, setState] = useState<T>(() =>
    parseFilters(new URLSearchParams(searchParams.toString()), defaultsRef.current),
  );

  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** What we last put in the URL, so our own writes are not read back. */
  const appliedQuery = useRef<string | null>(null);

  const writeUrl = useCallback(
    (value: T) => {
      const params = mergeFilterParams(
        new URLSearchParams(window.location.search),
        value,
        defaultsRef.current,
      );

      const query = params.toString();

      // `scroll: false` — a filter change is not a navigation, and jumping to
      // the top of the page every time a dropdown moves is disorienting.
      router.replace(query === "" ? pathname : `${pathname}?${query}`, {
        scroll: false,
      });
    },
    [pathname, router],
  );

  /**
   * Back and forward change the query string without going through `set`, so
   * the inputs are re-read from it. Only the declared keys are compared, so
   * our own `replace` — and any change to a foreign param — does not bounce.
   */
  useEffect(() => {
    const fromUrl = parseFilters(
      new URLSearchParams(searchParams.toString()),
      defaultsRef.current,
    );

    const owned = filterQuery(fromUrl, defaultsRef.current);

    if (owned === appliedQuery.current) return;

    appliedQuery.current = owned;
    setState(fromUrl);
  }, [searchParams]);

  const set = useCallback(
    (updates: Partial<T>) => {
      const touched = Object.keys(updates) as (keyof T)[];
      if (touched.length === 0) return;

      // Any filter other than the page itself invalidates the page number.
      const resetsPage =
        pageKey !== undefined && !touched.includes(pageKey);

      setState((current) => {
        const next = {
          ...current,
          ...updates,
          ...(resetsPage
            ? ({ [pageKey]: defaultsRef.current[pageKey] } as Partial<T>)
            : {}),
        } as T;

        appliedQuery.current = filterQuery(next, defaultsRef.current);

        if (pending.current) clearTimeout(pending.current);

        /**
         * An update made only of debounced keys waits; anything else flushes
         * at once. A dropdown moved while a search is mid-debounce therefore
         * carries the typed text with it rather than stranding it.
         */
        const wait = touched.every((key) => debounced.includes(key))
          ? debounceMs
          : 0;

        if (wait === 0) writeUrl(next);
        else pending.current = setTimeout(() => writeUrl(next), wait);

        return next;
      });
    },
    // `debounced` is a literal at every call site; depending on its identity
    // would rebuild `set` on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [debounceMs, pageKey, writeUrl],
  );

  const clear = useCallback(() => {
    if (pending.current) clearTimeout(pending.current);

    const next = { ...defaultsRef.current };

    appliedQuery.current = filterQuery(next, defaultsRef.current);
    setState(next);
    writeUrl(next);
  }, [writeUrl]);

  // A pending write must not fire after the component has gone.
  useEffect(
    () => () => {
      if (pending.current) clearTimeout(pending.current);
    },
    [],
  );

  return [state, set, clear];
}

export { hasActiveFilters } from "@/lib/filter-params";
export type { FilterShape, FilterValue } from "@/lib/filter-params";
