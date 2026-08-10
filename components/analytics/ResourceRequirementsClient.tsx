"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { Badge, type BadgeVariant } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { MultiSelectDropdown } from "@/components/ui/MultiSelectDropdown";
import { TableSkeleton } from "@/components/ui/Skeleton";
import {
  SummaryCard,
  useAnalyticsData,
} from "@/components/analytics/AnalyticsShell";
import type { AnalyticsOption } from "@/components/analytics/AnalyticsFilters";
import { useFilterState } from "@/lib/hooks/useFilterState";
import type {
  RequirementPractice,
  ResourceRequirementsResult,
} from "@/lib/analytics/resource-requirements";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const now = new Date();

/**
 * The report is per month because a requirement is per month. Its filters are
 * therefore its own rather than the shared date range — but they live in the
 * URL for the same reason every other list's do.
 */
const DEFAULTS = {
  month: now.getUTCMonth() + 1,
  year: now.getUTCFullYear(),
  practiceIds: [] as string[],
};

const YEARS = [now.getUTCFullYear() - 1, now.getUTCFullYear(), now.getUTCFullYear() + 1];

const STATUS: Record<
  RequirementPractice["status"],
  { label: string; variant: BadgeVariant }
> = {
  adequate: { label: "Adequate", variant: "brand" },
  tight: { label: "Tight", variant: "amber" },
  short: { label: "Short", variant: "red" },
  unset: { label: "No requirement set", variant: "neutral" },
};

function hours(value: number | null): string {
  if (value === null) return "—";
  return `${value.toFixed(1)}h`;
}

/** A gap is a shortfall when negative; showing the sign avoids a legend. */
function gapTone(gap: number | null): string {
  if (gap === null) return "text-slate-400";
  if (gap < 0) return "text-red-600";
  if (gap < 0.1) return "text-amber-600";
  return "text-emerald-600";
}

export function ResourceRequirementsClient({
  practices,
}: {
  practices: AnalyticsOption[];
}) {
  const [filters, setFilters, clearFilters] = useFilterState(DEFAULTS);
  const [expanded, setExpanded] = useState<string[]>([]);

  const query = useMemo(() => {
    const params = new URLSearchParams({
      month: String(filters.month),
      year: String(filters.year),
    });

    if (filters.practiceIds.length > 0) {
      params.set("practiceIds", filters.practiceIds.join(","));
    }

    return params.toString();
  }, [filters]);

  const { data, loading, error } =
    useAnalyticsData<ResourceRequirementsResult>(
      "/api/analytics/resource-requirements",
      query,
    );

  const toggle = (practiceId: string) =>
    setExpanded((current) =>
      current.includes(practiceId)
        ? current.filter((entry) => entry !== practiceId)
        : [...current, practiceId],
    );

  const filtersActive =
    filters.practiceIds.length > 0 ||
    filters.month !== DEFAULTS.month ||
    filters.year !== DEFAULTS.year;

  return (
    <div className="mx-auto max-w-[100rem]">
      <div className="mb-5">
        <h2 className="text-xl font-semibold tracking-tight text-slate-900">
          Resource Requirements
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          What each practice committed to, against the hours booked to deliver
          it. Requirements are set per practice under{" "}
          <Link
            href="/settings/practices"
            className="text-brand-600 hover:underline"
          >
            Settings → Practices
          </Link>
          .
        </p>
      </div>

      <div className="mb-5 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-card">
        <div>
          <label
            htmlFor="requirements-month"
            className="mb-1 block text-xs font-medium text-slate-600"
          >
            Month
          </label>
          <Select
            id="requirements-month"
            value={String(filters.month)}
            onChange={(event) =>
              setFilters({ month: Number(event.target.value) })
            }
            className="w-auto"
          >
            {MONTHS.map((label, index) => (
              <option key={label} value={index + 1}>
                {label}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <label
            htmlFor="requirements-year"
            className="mb-1 block text-xs font-medium text-slate-600"
          >
            Year
          </label>
          <Select
            id="requirements-year"
            value={String(filters.year)}
            onChange={(event) =>
              setFilters({ year: Number(event.target.value) })
            }
            className="w-auto"
          >
            {YEARS.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </Select>
        </div>

        <div className="min-w-[200px]">
          <label className="mb-1 block text-xs font-medium text-slate-600">
            Practice
          </label>
          <MultiSelectDropdown
            options={practices.map((entry) => ({
              value: entry.id,
              label: entry.name,
            }))}
            selected={filters.practiceIds}
            onChange={(next) => setFilters({ practiceIds: next })}
            placeholder="All practices"
            allLabel="All practices"
            noun="practices"
            aria-label="Filter by practice"
          />
        </div>

        {filtersActive ? (
          <button
            type="button"
            onClick={clearFilters}
            className="pb-2 text-xs font-medium text-slate-500 hover:text-slate-800"
          >
            Clear filters
          </button>
        ) : null}
      </div>

      {error ? (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          label="Practices understaffed"
          value={String(data?.summary.understaffed ?? 0)}
          tone={
            (data?.summary.understaffed ?? 0) > 0 ? "text-red-600" : undefined
          }
        />
        <SummaryCard
          label="Practices adequately staffed"
          value={String(data?.summary.adequate ?? 0)}
        />
        <SummaryCard
          label="Total shortfall"
          value={`${data?.summary.totalShortfallHours ?? 0}h`}
          hint="Across every short practice this month"
        />
        <SummaryCard
          label="Billers with spare capacity"
          value={String(data?.summary.billersWithCapacity ?? 0)}
        />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-card">
        <div className="border-b border-slate-100 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-900">
            {MONTHS[filters.month - 1]} {filters.year}
          </h3>
        </div>

        {loading ? (
          <div className="p-4">
            <TableSkeleton rows={5} columns={6} />
          </div>
        ) : !data || data.practices.length === 0 ? (
          <EmptyState
            title="No practices to report on"
            description="Add a practice, or widen the filter."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Practice</th>
                  <th className="px-4 py-3 text-right">Required</th>
                  <th className="px-4 py-3 text-right">Assigned</th>
                  <th className="px-4 py-3 text-right">Projected</th>
                  <th className="px-4 py-3 text-right">Buffer</th>
                  <th className="px-4 py-3 text-right">Billers</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.practices.map((practice) => {
                  const open = expanded.includes(practice.practiceId);
                  const status = STATUS[practice.status];

                  return (
                    <Fragment key={practice.practiceId}>
                      <tr>
                        <td className="px-4 py-2.5">
                          <button
                            type="button"
                            onClick={() => toggle(practice.practiceId)}
                            aria-expanded={open}
                            className="flex items-center gap-1.5 font-medium text-slate-900 hover:text-brand-700"
                          >
                            <span className="text-slate-400">
                              {open ? "▼" : "▶"}
                            </span>
                            {practice.practiceName}
                          </button>
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {practice.status === "unset"
                            ? "—"
                            : hours(practice.requiredHours)}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {hours(practice.assignedHours)}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">
                          {hours(practice.projectedHours)}
                        </td>
                        <td
                          className={`px-4 py-2.5 text-right font-medium tabular-nums ${
                            practice.status === "unset"
                              ? "text-slate-400"
                              : gapTone(practice.bufferHours)
                          }`}
                        >
                          {practice.status === "unset"
                            ? "—"
                            : `${practice.bufferHours > 0 ? "+" : ""}${practice.bufferHours.toFixed(1)}h`}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">
                          {practice.billerCount}
                        </td>
                        <td className="px-4 py-2.5">
                          <Badge variant={status.variant}>{status.label}</Badge>
                        </td>
                      </tr>

                      {open ? (
                        <tr className="bg-slate-50/70">
                          <td colSpan={7} className="px-4 py-3">
                            {practice.taskTypes.length === 0 ? (
                              <p className="text-xs text-slate-500">
                                No monthly requirement has been set for this
                                practice, and no work is booked to it this
                                month.
                              </p>
                            ) : (
                              <table className="w-full text-[13px]">
                                <thead className="text-left text-[11px] font-medium uppercase tracking-wide text-slate-500">
                                  <tr>
                                    <th className="py-1.5">Task type</th>
                                    <th className="py-1.5 text-right">
                                      Required
                                    </th>
                                    <th className="py-1.5 text-right">
                                      Assigned
                                    </th>
                                    <th className="py-1.5 text-right">
                                      Projected
                                    </th>
                                    <th className="py-1.5 text-right">Gap</th>
                                    <th className="py-1.5 text-right">
                                      Units / month
                                    </th>
                                    <th className="py-1.5 text-right">
                                      Min / unit
                                    </th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-200/70">
                                  {practice.taskTypes.map((row) => (
                                    <tr key={row.taskTypeId}>
                                      <td className="py-1.5 text-slate-800">
                                        {row.taskTypeName}
                                        {row.notes ? (
                                          <span
                                            className="ml-1.5 text-slate-400"
                                            title={row.notes}
                                          >
                                            ⓘ
                                          </span>
                                        ) : null}
                                      </td>
                                      <td className="py-1.5 text-right tabular-nums">
                                        {hours(row.requiredHours)}
                                      </td>
                                      <td className="py-1.5 text-right tabular-nums">
                                        {hours(row.assignedHours)}
                                      </td>
                                      <td className="py-1.5 text-right tabular-nums text-slate-500">
                                        {hours(row.projectedHours)}
                                      </td>
                                      <td
                                        className={`py-1.5 text-right font-medium tabular-nums ${gapTone(row.gapHours)}`}
                                      >
                                        {row.gapHours === null
                                          ? "—"
                                          : `${row.gapHours > 0 ? "+" : ""}${row.gapHours.toFixed(1)}h`}
                                      </td>
                                      <td className="py-1.5 text-right tabular-nums text-slate-600">
                                        {row.unitsPerMonth ?? "—"}
                                      </td>
                                      <td className="py-1.5 text-right tabular-nums text-slate-600">
                                        {row.minutesPerUnit === null
                                          ? "—"
                                          : row.minutesPerUnit.toFixed(1)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}

                            {practice.billers.length > 0 ? (
                              <p className="mt-2 text-xs text-slate-500">
                                Staffed by{" "}
                                {practice.billers
                                  .map((biller) => biller.name)
                                  .join(", ")}
                                .
                              </p>
                            ) : (
                              <p className="mt-2 text-xs text-amber-700">
                                Nobody is assigned to this practice.
                              </p>
                            )}
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {data && data.suggestions.length > 0 ? (
        <div className="mt-5 rounded-xl border border-slate-200 bg-white shadow-card">
          <div className="border-b border-slate-100 px-4 py-3">
            <h3 className="text-sm font-semibold text-slate-900">
              Rebalancing suggestions
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Where a shortfall meets someone with room this month.
            </p>
          </div>
          <ul className="divide-y divide-slate-100">
            {data.suggestions.map((suggestion, index) => (
              <li
                key={`${suggestion.practiceId}-${suggestion.candidateUserId}-${index}`}
                className="px-4 py-3 text-sm text-slate-800"
              >
                {suggestion.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
