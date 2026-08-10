"use client";

import { useMemo, useState } from "react";
import { EmptyState } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { TableSkeleton } from "@/components/ui/Skeleton";
import {
  analyticsQuery,
  AnalyticsPage,
  SummaryCard,
  useAnalyticsData,
  useAnalyticsFilters,
} from "@/components/analytics/AnalyticsShell";
import type { AnalyticsOption } from "@/components/analytics/AnalyticsFilters";
import { formatMinutes } from "@/lib/task-timer-serialize";
import type { WorkloadDay, WorkloadResult } from "@/lib/analytics/workload";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * A day's colour.
 *
 * Read left to right: nothing at all is blank rather than green, because an
 * empty day is a question and a full one is not. Over capacity is the only
 * red — the point of the grid is to find the two ends.
 */
function dayTone(day: WorkloadDay, target: number): string {
  if (day.isWeekend) return "bg-slate-50";
  if (day.totalMinutes === 0) return "bg-white";
  if (day.isOverCapacity) return "bg-red-500";
  if (day.totalMinutes < 5 * 60) return "bg-amber-400";
  if (day.totalMinutes < target * 0.9) return "bg-amber-300";
  return "bg-emerald-500";
}

function tooltipFor(day: WorkloadDay): string {
  if (day.items.length === 0) return `${day.date}: nothing assigned`;

  const lines = day.items
    .slice(0, 8)
    .map(
      (item) =>
        `${item.label}${item.practiceName ? ` · ${item.practiceName}` : ""} — ${formatMinutes(item.minutes)}${item.isProjected ? " (proj)" : ""}`,
    );

  if (day.items.length > 8) lines.push(`+${day.items.length - 8} more`);

  return `${day.date}\n${lines.join("\n")}`;
}

export function WorkloadClient({
  options,
}: {
  options: {
    billers: AnalyticsOption[];
    practices: AnalyticsOption[];
    taskTypes: AnalyticsOption[];
  };
}) {
  const [filters, setFilters, clearFilters] = useAnalyticsFilters();
  const [targetHours, setTargetHours] = useState("7.5");

  const query = useMemo(
    () => analyticsQuery(filters, { targetHours }),
    [filters, targetHours],
  );

  const { data, loading, error } = useAnalyticsData<WorkloadResult>(
    "/api/analytics/workload",
    query,
  );

  const target = data?.targetMinutesPerDay ?? 450;

  return (
    <AnalyticsPage
      title="Workload Planner"
      description="Who is booked, who is free, and where the gaps are. Striped cells are recurring work that has not been generated yet."
      filters={filters}
      setFilters={setFilters}
      clearFilters={clearFilters}
      options={options}
      show={{ taskType: false }}
      error={error}
      filterExtras={
        <div>
          <label
            htmlFor="workload-target"
            className="mb-1 block text-xs font-medium text-slate-600"
          >
            Daily target
          </label>
          <Select
            id="workload-target"
            value={targetHours}
            onChange={(event) => setTargetHours(event.target.value)}
            className="w-auto"
          >
            <option value="7.5">7.5 hours</option>
            <option value="8">8 hours</option>
          </Select>
        </div>
      }
    >
      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          label="Billers over capacity"
          value={String(data?.summary.overCapacity ?? 0)}
          tone={
            (data?.summary.overCapacity ?? 0) > 0 ? "text-red-600" : undefined
          }
        />
        <SummaryCard
          label="Billers under-assigned"
          value={String(data?.summary.underAssigned ?? 0)}
          tone={
            (data?.summary.underAssigned ?? 0) > 0
              ? "text-amber-600"
              : undefined
          }
          hint="Below 6h on most working days"
        />
        <SummaryCard
          label="Unassigned capacity"
          value={`${data?.summary.unassignedCapacityHours ?? 0}h`}
          hint="Against the daily target, ahead of today"
        />
        <SummaryCard
          label="Days with nothing on"
          value={String(data?.summary.daysWithGaps ?? 0)}
        />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-card">
        <div className="border-b border-slate-100 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-900">
            Assigned hours by day
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Past days show time actually logged; today and later show what is
            assigned. Hover a cell for what is on it.
          </p>
        </div>

        {loading ? (
          <div className="p-4">
            <TableSkeleton rows={5} columns={8} />
          </div>
        ) : !data || data.billers.length === 0 ? (
          <EmptyState
            title="Nobody to plan for"
            description="Billers appear here once they are assigned to a practice."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="sticky left-0 z-10 bg-slate-50 px-4 py-3 text-left">
                    Biller
                  </th>
                  {data.dates.map((date) => {
                    const day = new Date(`${date}T00:00:00.000Z`);

                    return (
                      <th key={date} className="px-1.5 py-3 text-center">
                        <div>{DAY_NAMES[day.getUTCDay()]}</div>
                        <div className="font-normal text-slate-400">
                          {date.slice(8)}
                        </div>
                      </th>
                    );
                  })}
                  <th className="px-4 py-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.billers.map((biller) => (
                  <tr key={biller.userId}>
                    <td className="sticky left-0 z-10 bg-white px-4 py-2 font-medium text-slate-900">
                      {biller.name}
                    </td>
                    {biller.days.map((day) => (
                      <td key={day.date} className="px-1 py-2">
                        <div
                          title={tooltipFor(day)}
                          className={`relative mx-auto h-9 w-9 rounded ${dayTone(day, target)} ring-1 ring-inset ring-slate-200`}
                        >
                          {/*
                            Projected load is drawn as a hatch over the same
                            colour, so a full day of forecast never reads as a
                            full day of committed work.
                          */}
                          {day.projectedMinutes > 0 ? (
                            <span
                              className="absolute inset-0 rounded opacity-60"
                              style={{
                                backgroundImage:
                                  "repeating-linear-gradient(45deg, rgba(255,255,255,.85) 0 3px, transparent 3px 6px)",
                              }}
                            />
                          ) : null}
                          <span className="relative flex h-full items-center justify-center text-[10px] font-medium text-white mix-blend-luminosity">
                            {day.totalMinutes > 0
                              ? Math.round(day.totalMinutes / 60)
                              : ""}
                          </span>
                        </div>
                      </td>
                    ))}
                    <td className="px-4 py-2 text-right tabular-nums text-slate-700">
                      {formatMinutes(biller.totalMinutes)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {data && data.alerts.length > 0 ? (
        <div className="mt-5 rounded-xl border border-slate-200 bg-white shadow-card">
          <div className="border-b border-slate-100 px-4 py-3">
            <h3 className="text-sm font-semibold text-slate-900">
              What needs attention
            </h3>
          </div>
          <ul className="divide-y divide-slate-100">
            {data.alerts.map((alert, index) => (
              <li
                key={`${alert.userId}-${index}`}
                className="flex items-start gap-3 px-4 py-3"
              >
                <span
                  className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                    alert.severity === "red" ? "bg-red-500" : "bg-amber-400"
                  }`}
                />
                <div>
                  <p className="text-sm text-slate-800">{alert.message}</p>
                  {alert.suggestion ? (
                    <p className="mt-0.5 text-xs text-slate-500">
                      {alert.suggestion}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </AnalyticsPage>
  );
}
