"use client";

import { formatUSD } from "@/lib/format";

export interface ClaimListMeta {
  totalCount: number;
  totalBalance: string;
  redCount: number;
  blueCount: number;
  greenCount: number;
  unassignedCount: number;
  avgAgingDays: number;
  page: number;
  totalPages: number;
  limit: number;
}

/**
 * What the current filters add up to, above the table they describe.
 *
 * Every figure is over **actionable** claims, whatever the rows below show —
 * the "Include 0–30 day claims" box can put fresh claims on screen, but a
 * total, a balance or an average here describes workable claims, as every
 * other summary in the AR module does. The label says so, so the count is not
 * mistaken for the pagination total.
 */
export function BatchSummaryBar({
  meta,
  filtered,
  loading,
}: {
  meta: ClaimListMeta | null;
  /** Any filter or a narrowing tab is in effect. */
  filtered: boolean;
  loading: boolean;
}) {
  if (!meta) {
    return (
      <div className="mb-3 h-11 animate-pulse rounded-lg bg-slate-100" />
    );
  }

  return (
    <div
      className={`mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border px-4 py-2.5 text-sm transition-opacity ${
        filtered ? "border-brand-200 bg-brand-50/40" : "border-slate-200 bg-white"
      } ${loading ? "opacity-60" : ""}`}
    >
      <span className="font-semibold tabular-nums text-slate-900">
        {meta.totalCount.toLocaleString()} claim{meta.totalCount === 1 ? "" : "s"}
      </span>

      <span className="font-semibold tabular-nums text-slate-900">
        {formatUSD(meta.totalBalance)}
      </span>

      <span className="flex items-center gap-1.5 text-xs">
        <span className="rounded-full bg-red-50 px-2 py-0.5 font-medium tabular-nums text-red-700 ring-1 ring-inset ring-red-200">
          {meta.redCount} red
        </span>
        <span className="text-slate-300">·</span>
        <span className="rounded-full bg-sky-50 px-2 py-0.5 font-medium tabular-nums text-sky-700 ring-1 ring-inset ring-sky-200">
          {meta.blueCount} blue
        </span>
        <span className="text-slate-300">·</span>
        <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium tabular-nums text-emerald-700 ring-1 ring-inset ring-emerald-200">
          {meta.greenCount} green
        </span>
      </span>

      {meta.unassignedCount > 0 ? (
        <span className="text-xs font-medium tabular-nums text-amber-700">
          {meta.unassignedCount} unassigned
        </span>
      ) : null}

      <span className="text-xs tabular-nums text-slate-600">
        Avg {meta.avgAgingDays} days
      </span>

      <span className="ml-auto text-[11px] text-slate-500">
        {filtered ? (
          <span className="rounded bg-brand-100 px-1.5 py-0.5 font-medium text-brand-800">
            filtered
          </span>
        ) : (
          "batch totals"
        )}{" "}
        · excludes 0–30 day claims
      </span>
    </div>
  );
}
