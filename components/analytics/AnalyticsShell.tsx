"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AnalyticsFilters,
  type AnalyticsFilterValue,
  type AnalyticsOption,
} from "@/components/analytics/AnalyticsFilters";
import { useFilterState } from "@/lib/hooks/useFilterState";
import { resolvePeriod, toDateParam } from "@/lib/analytics/periods";

/**
 * The plumbing every analytics page repeats: filters in the URL, a fetch that
 * follows them, and the loading and error states around it.
 *
 * Written once so the five reports cannot drift on what a filter means or on
 * how a failed request looks. Each page supplies the endpoint and the way to
 * draw the answer; nothing else.
 */

const thisMonth = resolvePeriod("this_month");

export const ANALYTICS_FILTER_DEFAULTS = {
  period: "this_month",
  from: toDateParam(thisMonth.from),
  to: toDateParam(thisMonth.to),
  billerIds: [] as string[],
  practiceIds: [] as string[],
  taskTypeIds: [] as string[],
};

export function useAnalyticsFilters() {
  return useFilterState(ANALYTICS_FILTER_DEFAULTS);
}

/** The query string these filters make, shared by the fetch and any export. */
export function analyticsQuery(
  filters: AnalyticsFilterValue,
  extra: Record<string, string | undefined> = {},
): string {
  const params = new URLSearchParams({ from: filters.from, to: filters.to });

  if (filters.billerIds.length > 0) {
    params.set("billerIds", filters.billerIds.join(","));
  }
  if (filters.practiceIds.length > 0) {
    params.set("practiceIds", filters.practiceIds.join(","));
  }
  if (filters.taskTypeIds.length > 0) {
    params.set("taskTypeIds", filters.taskTypeIds.join(","));
  }

  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined && value !== "") params.set(key, value);
  }

  return params.toString();
}

/** Fetches an analytics endpoint whenever the query changes. */
export function useAnalyticsData<T>(endpoint: string, query: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${endpoint}?${query}`);
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setError(payload?.error ?? "Could not load this report.");
        setData(null);
        return;
      }

      setData(payload as T);
    } catch {
      setError("Could not load this report. Check your connection.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [endpoint, query]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, reload: load };
}

export function AnalyticsPage({
  title,
  description,
  filters,
  setFilters,
  clearFilters,
  options,
  show,
  filterExtras,
  error,
  children,
}: {
  title: string;
  description: string;
  filters: AnalyticsFilterValue;
  setFilters: (updates: Partial<AnalyticsFilterValue>) => void;
  clearFilters: () => void;
  options: {
    billers: AnalyticsOption[];
    practices: AnalyticsOption[];
    taskTypes: AnalyticsOption[];
  };
  show?: Parameters<typeof AnalyticsFilters>[0]["show"];
  filterExtras?: React.ReactNode;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-[100rem]">
      <div className="mb-5">
        <h2 className="text-xl font-semibold tracking-tight text-slate-900">
          {title}
        </h2>
        <p className="mt-1 text-sm text-slate-500">{description}</p>
      </div>

      <div className="mb-5">
        <AnalyticsFilters
          value={filters}
          onChange={setFilters}
          onClear={clearFilters}
          billers={options.billers}
          practices={options.practices}
          taskTypes={options.taskTypes}
          show={show}
        >
          {filterExtras}
        </AnalyticsFilters>
      </div>

      {error ? (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {children}
    </div>
  );
}

/** One figure above a report. */
export function SummaryCard({
  label,
  value,
  tone,
  hint,
  onClick,
  active,
}: {
  label: string;
  value: string;
  tone?: string;
  hint?: string;
  /** Cards that narrow the table below them are buttons, not decoration. */
  onClick?: () => void;
  active?: boolean;
}) {
  const body = (
    <>
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p
        className={`mt-1 text-2xl font-semibold tabular-nums ${tone ?? "text-slate-900"}`}
      >
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-xs text-slate-500">{hint}</p> : null}
    </>
  );

  const shell = `rounded-xl border bg-white p-4 text-left shadow-card ${
    active ? "border-brand-500 ring-1 ring-brand-200" : "border-slate-200"
  }`;

  if (!onClick) return <div className={shell}>{body}</div>;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`${shell} transition-colors hover:border-brand-400`}
    >
      {body}
    </button>
  );
}
