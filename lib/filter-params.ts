/**
 * How a list's filters are written into, and read back out of, a query string.
 *
 * Split out of [lib/hooks/useFilterState.ts](lib/hooks/useFilterState.ts) —
 * free of React and of `next/navigation` — so the encoding can be tested on
 * its own and reused by any server component that needs to read the same URL.
 *
 * The shape of each value is inferred from its **default**, which is the one
 * place a list declares what kind of filter each key is.
 */

export type FilterValue = string | string[] | number | boolean;
export type FilterShape = Record<string, FilterValue>;

/**
 * One value as the URL carries it, or null to leave it out.
 *
 * A value equal to its default carries no information, so it is omitted —
 * that is what makes an empty query string mean "nothing filtered", and what
 * lets "clear filters" be nothing more than dropping the params.
 *
 * Anything *not* equal to its default is written, **including an empty one**.
 * Some lists are opened from a link that seeds a filter — the Team page sends
 * you to `/tasks/list?assignedToId=…` — and that seed becomes the default.
 * Clearing such a filter has to leave a mark in the URL (`assignedToId=`),
 * or reading it back would restore the seed and the filter would refuse to
 * clear.
 */
export function encodeFilterValue(
  value: FilterValue,
  fallback: FilterValue,
): string | null {
  if (Array.isArray(value)) {
    const fallbackList = Array.isArray(fallback) ? fallback : [];
    const same =
      value.length === fallbackList.length &&
      value.every((entry, index) => entry === fallbackList[index]);

    // An empty list that differs from its seed still needs to be recorded.
    return same ? null : value.join(",");
  }

  if (typeof value === "boolean") {
    return value === fallback ? null : value ? "true" : "false";
  }

  const text = String(value);

  return text === String(fallback) ? null : text;
}

/** Reads one value back, using the default to know what shape to expect. */
export function decodeFilterValue(
  raw: string | null,
  fallback: FilterValue,
): FilterValue {
  if (raw === null) return Array.isArray(fallback) ? [...fallback] : fallback;

  if (Array.isArray(fallback)) {
    return raw
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry !== "");
  }

  if (typeof fallback === "boolean") return raw === "true";

  if (typeof fallback === "number") {
    const parsed = Number(raw);
    // A hand-edited "page=banana" falls back rather than poisoning the query.
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return raw;
}

/** Every declared key, read out of a query string. */
export function parseFilters<T extends FilterShape>(
  params: URLSearchParams,
  defaults: T,
): T {
  const next = {} as T;

  for (const key of Object.keys(defaults) as (keyof T)[]) {
    next[key] = decodeFilterValue(
      params.get(String(key)),
      defaults[key],
    ) as T[typeof key];
  }

  return next;
}

/**
 * The declared keys as a query string, in the order they were declared.
 *
 * Deterministic on purpose: the hook compares this against what it last wrote
 * to tell its own URL updates apart from a back-button navigation.
 */
export function filterQuery<T extends FilterShape>(
  state: T,
  defaults: T,
): string {
  const params = new URLSearchParams();

  for (const key of Object.keys(defaults) as (keyof T)[]) {
    const encoded = encodeFilterValue(state[key], defaults[key]);
    if (encoded !== null) params.set(String(key), encoded);
  }

  return params.toString();
}

/**
 * Merges the declared keys into an existing query string, leaving anything
 * else in it untouched — the top bar's practice selector, for one.
 */
export function mergeFilterParams<T extends FilterShape>(
  existing: URLSearchParams,
  state: T,
  defaults: T,
): URLSearchParams {
  const params = new URLSearchParams(existing.toString());

  for (const key of Object.keys(defaults) as (keyof T)[]) {
    const encoded = encodeFilterValue(state[key], defaults[key]);

    if (encoded === null) params.delete(String(key));
    else params.set(String(key), encoded);
  }

  return params;
}

/** True when anything is set away from its default — drives "Clear filters". */
export function hasActiveFilters<T extends FilterShape>(
  state: T,
  defaults: T,
  /** Keys that are not filters, typically the page and the page size. */
  ignore: (keyof T)[] = [],
): boolean {
  return (Object.keys(defaults) as (keyof T)[]).some((key) => {
    if (ignore.includes(key)) return false;

    const value = state[key];

    if (Array.isArray(value)) return value.length > 0;

    return value !== defaults[key] && value !== "";
  });
}
