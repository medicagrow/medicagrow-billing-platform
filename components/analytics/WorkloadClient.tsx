"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
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
import type {
  WorkloadDay,
  WorkloadItem,
  WorkloadResult,
} from "@/lib/analytics/workload";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** One swatch in the grid's legend. */
function Key({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`h-3 w-3 rounded-sm ring-1 ring-inset ring-slate-300 ${className}`}
      />
      {label}
    </span>
  );
}

function tooltipFor(day: WorkloadDay): string {
  if (day.items.length === 0) return `${day.date}: nothing assigned`;

  const lines = day.items.slice(0, 8).map((item) => {
    // An AR block is a rate over a range, so its tooltip gives the whole
    // shape of the commitment rather than just today's share of it.
    if (item.kind === "ar") {
      return `AR Follow-up — ${item.practiceName ?? "No practice"} — ${
        item.dailyHours ?? 0
      }h/day — ${(item.startDate ?? "").slice(0, 10)} to ${(
        item.dueDate ?? ""
      ).slice(0, 10)}${item.isOtherPm ? " (other PM)" : ""}`;
    }

    return `${item.label}${
      item.practiceName ? ` · ${item.practiceName}` : ""
    } — ${formatMinutes(item.minutes)}${item.isProjected ? " (proj)" : ""}`;
  });

  if (day.items.length > 8) lines.push(`+${day.items.length - 8} more`);

  return `${day.date}\n${lines.join("\n")}`;
}

/**
 * AR is teal so it reads as a standing commitment rather than a verdict —
 * green/amber/red on this grid mean "how full is the day", and a block that is
 * always there should not compete with that. Another PM's AR is paler still:
 * visible, because it consumes the day either way, but plainly not this PM's
 * to move.
 */
function segmentTone(item: WorkloadItem, day: WorkloadDay): string {
  if (item.kind === "ar") {
    return item.isOtherPm ? "bg-teal-200" : "bg-teal-500";
  }

  if (item.kind === "projected") return "bg-slate-400";

  return day.isOverCapacity ? "bg-red-500" : "bg-emerald-500";
}

/**
 * One day's cell, drawn as a stack rather than a single colour.
 *
 * A biller's day is rarely one thing: two practices' AR plus a charge-posting
 * task is three commitments, and a flat green square hides which of them to
 * move when the day is full. Each segment's height is its share of the target
 * day, so the cell reads as "how full, and with what".
 */
function DayCell({ day, target }: { day: WorkloadDay; target: number }) {
  if (day.isWeekend) {
    return (
      <div className="mx-auto h-9 w-9 rounded bg-slate-50 ring-1 ring-inset ring-slate-200" />
    );
  }

  if (day.items.length === 0) {
    return (
      <div
        title={tooltipFor(day)}
        className="mx-auto h-9 w-9 rounded bg-white ring-1 ring-inset ring-slate-200"
      />
    );
  }

  // A stable order, so a cell does not reshuffle between loads.
  const order: Record<WorkloadItem["kind"], number> = {
    ar: 0,
    assigned: 1,
    projected: 2,
  };

  const segments = [...day.items].sort(
    (a, b) => order[a.kind] - order[b.kind],
  );

  return (
    <div
      title={tooltipFor(day)}
      className={`relative mx-auto flex h-9 w-9 flex-col-reverse overflow-hidden rounded ring-1 ring-inset ${
        day.isOverCapacity ? "ring-2 ring-red-500" : "ring-slate-200"
      }`}
    >
      {segments.map((item, index) => (
        <span
          key={`${item.taskId ?? item.label}-${index}`}
          className={`relative w-full ${segmentTone(item, day)}`}
          style={{
            // Floored so a short task is still visible, capped so an
            // over-capacity day shows every segment rather than one pushing
            // the rest out of the cell.
            height: `${Math.max(8, Math.min(100, (item.minutes / target) * 100))}%`,
          }}
        >
          {item.kind === "projected" ? (
            <span
              className="absolute inset-0 opacity-60"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(45deg, rgba(255,255,255,.85) 0 3px, transparent 3px 6px)",
              }}
            />
          ) : null}
        </span>
      ))}

      <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[10px] font-semibold text-white mix-blend-luminosity">
        {Math.round(day.totalMinutes / 60)}
      </span>
    </div>
  );
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
          label="AR tasks unconfigured"
          value={String(data?.summary.unconfiguredArTasks ?? 0)}
          tone={
            (data?.summary.unconfiguredArTasks ?? 0) > 0
              ? "text-amber-600"
              : undefined
          }
          hint="No daily hours — not counted anywhere below"
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

          <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-slate-600">
            <Key className="bg-teal-500" label="AR follow-up" />
            <Key className="bg-teal-200" label="AR — another PM's practice" />
            <Key className="bg-emerald-500" label="Assigned task" />
            <Key className="bg-red-500" label="Over capacity" />
            <Key className="bg-slate-400" label="Projected (recurring)" />
          </div>
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
                        <DayCell day={day} target={target} />
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

      {/*
        Unconfigured AR sits directly under the grid rather than among the
        alerts, because it is a statement about the grid itself: these tasks
        are consuming somebody's day and are drawn nowhere above.
      */}
      {data && data.summary.unconfiguredArTasks > 0 ? (
        <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <h3 className="text-sm font-semibold text-amber-900">
            ⚠ Some AR work is missing from this grid
          </h3>
          <ul className="mt-2 space-y-2">
            {data.billers
              .filter((biller) => biller.unconfiguredAr.length > 0)
              .map((biller) => (
                <li key={biller.userId} className="text-xs text-amber-900">
                  <span className="font-medium">
                    {biller.name} has {biller.unconfiguredAr.length} AR task
                    {biller.unconfiguredAr.length === 1 ? "" : "s"} with no
                    daily hours configured — workload planner may be inaccurate
                  </span>
                  <ul className="mt-1 space-y-0.5 pl-4">
                    {biller.unconfiguredAr.map((task) => (
                      <li key={task.taskId} className="text-amber-800">
                        {task.practiceName ?? "No practice"}
                        {task.dueDate
                          ? ` · due ${task.dueDate.slice(0, 10)}`
                          : ""}{" "}
                        {task.canConfigure ? (
                          <Link
                            href={`/tasks/list?search=&practiceId=${task.practiceId ?? ""}`}
                            className="font-medium underline"
                          >
                            Configure →
                          </Link>
                        ) : (
                          // Another PM's practice: visible, since it consumes
                          // this biller's day, but not this PM's to set.
                          <span className="text-amber-700">
                            (another PM&rsquo;s practice)
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
          </ul>
        </div>
      ) : null}

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
