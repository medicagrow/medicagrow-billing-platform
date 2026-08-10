"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
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
import { downloadCsv } from "@/lib/csv-export";
import { formatUSD } from "@/lib/format";
import { formatMinutes } from "@/lib/task-timer-serialize";
import { formatDuration } from "@/lib/analytics/shared";
import type {
  GroupDimension,
  GroupNode,
  TimeProductivityResult,
} from "@/lib/analytics/time-productivity";

const GROUPINGS: { value: GroupDimension; label: string }[] = [
  { value: "biller", label: "Biller → Practice → Task type" },
  { value: "practice", label: "Practice → Biller → Task type" },
  { value: "taskType", label: "Task type → Biller → Practice" },
];

/** Lower is better: under the estimate is green, well over it is red. */
function efficiencyTone(rate: number | null): string {
  if (rate === null) return "text-slate-400";
  if (rate < 100) return "text-emerald-600";
  if (rate <= 120) return "text-amber-600";
  return "text-red-600";
}

function rate(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)}%`;
}

export function TimeProductivityClient({
  options,
}: {
  options: {
    billers: AnalyticsOption[];
    practices: AnalyticsOption[];
    taskTypes: AnalyticsOption[];
  };
}) {
  const [filters, setFilters, clearFilters] = useAnalyticsFilters();
  const [groupBy, setGroupBy] = useState<GroupDimension>("biller");
  const [expanded, setExpanded] = useState<string[]>([]);

  const query = useMemo(
    () => analyticsQuery(filters, { groupBy }),
    [filters, groupBy],
  );

  const { data, loading, error } = useAnalyticsData<TimeProductivityResult>(
    "/api/analytics/time-productivity",
    query,
  );

  const toggle = (path: string) =>
    setExpanded((current) =>
      current.includes(path)
        ? current.filter((entry) => entry !== path)
        : [...current, path],
    );

  /** Rows flattened to what is currently visible — what a CSV should carry. */
  const visibleRows = useMemo(() => {
    if (!data) return [];

    const out: { depth: number; path: string; node: GroupNode }[] = [];

    const walk = (nodes: GroupNode[], depth: number, parentPath: string) => {
      for (const node of nodes) {
        const path = `${parentPath}/${node.key}`;

        out.push({ depth, path, node });

        if (expanded.includes(path)) walk(node.children, depth + 1, path);
      }
    };

    walk(data.rows, 0, "");
    return out;
  }, [data, expanded]);

  function exportCsv() {
    if (!data) return;

    downloadCsv(
      `time-productivity-${filters.from}-to-${filters.to}.csv`,
      [
        "Level",
        "Name",
        "Time logged (minutes)",
        "Units",
        "Avg seconds per unit",
        "Amount",
        "Estimated (minutes)",
        "Efficiency %",
        "Closed tasks",
        "Sessions",
      ],
      visibleRows.map(({ depth, node }) => [
        data.groupBy[depth] ?? String(depth),
        `${"  ".repeat(depth)}${node.label}`,
        node.loggedMinutes,
        node.units,
        node.secondsPerUnit ?? "",
        node.amount ?? "",
        node.estimatedMinutes,
        node.efficiencyRate ?? "",
        node.closedTasks,
        node.sessions,
      ]),
    );
  }

  const total = data?.total;

  return (
    <AnalyticsPage
      title="Time & Productivity"
      description="What the time went on, and what came out of it."
      filters={filters}
      setFilters={setFilters}
      clearFilters={clearFilters}
      options={options}
      error={error}
      filterExtras={
        <div>
          <label
            htmlFor="analytics-group-by"
            className="mb-1 block text-xs font-medium text-slate-600"
          >
            Group by
          </label>
          <Select
            id="analytics-group-by"
            value={groupBy}
            onChange={(event) => {
              setGroupBy(event.target.value as GroupDimension);
              // Paths are built from the old hierarchy and mean nothing in
              // the new one.
              setExpanded([]);
            }}
            className="w-auto min-w-[240px]"
          >
            {GROUPINGS.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </Select>
        </div>
      }
    >
      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          label="Total time logged"
          value={formatMinutes(total?.loggedMinutes ?? 0)}
          hint={`Estimated ${formatMinutes(total?.estimatedMinutes ?? 0)}`}
        />
        <SummaryCard
          label="Total units completed"
          value={String(total?.units ?? 0)}
          hint="Charges, payments, claims — by task type"
        />
        <SummaryCard
          label="Avg time per unit"
          value={formatDuration(total?.secondsPerUnit ?? null)}
        />
        <SummaryCard
          label="Overall efficiency"
          value={rate(total?.efficiencyRate ?? null)}
          tone={efficiencyTone(total?.efficiencyRate ?? null)}
          hint="Logged ÷ estimated"
        />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-card">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-900">
            {GROUPINGS.find((entry) => entry.value === groupBy)?.label}
          </h3>
          <Button
            variant="secondary"
            className="px-3 py-2 text-xs"
            onClick={exportCsv}
            disabled={loading || !data}
          >
            Export CSV
          </Button>
        </div>

        {loading ? (
          <div className="p-4">
            <TableSkeleton rows={6} columns={7} />
          </div>
        ) : !data || data.rows.length === 0 ? (
          <EmptyState
            title="No time logged in this period"
            description="Widen the dates, or clear a filter."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3 text-right">Time logged</th>
                  <th className="px-4 py-3 text-right">Units</th>
                  <th className="px-4 py-3 text-right">Avg / unit</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3 text-right">Estimated</th>
                  <th className="px-4 py-3 text-right">vs estimate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleRows.map(({ depth, path, node }) => {
                  const open = expanded.includes(path);
                  const hasChildren = node.children.length > 0;

                  return (
                    <Fragment key={path}>
                      <tr
                        className={
                          depth === 0 ? "bg-white" : "bg-slate-50/60 text-[13px]"
                        }
                      >
                        <td className="px-4 py-2.5">
                          <div
                            className="flex items-center gap-1.5"
                            style={{ paddingLeft: `${depth * 20}px` }}
                          >
                            {hasChildren ? (
                              <button
                                type="button"
                                onClick={() => toggle(path)}
                                aria-expanded={open}
                                aria-label={`${open ? "Collapse" : "Expand"} ${node.label}`}
                                className="text-slate-400 hover:text-slate-700"
                              >
                                {open ? "▼" : "▶"}
                              </button>
                            ) : (
                              <span className="w-3" />
                            )}
                            {/*
                              A top-level biller row keeps its drill-down into
                              the per-person activity page — that page survived
                              the rebuild and this is now the way in.
                            */}
                            {depth === 0 && groupBy === "biller" ? (
                              <Link
                                href={`/productivity/${node.key}?from=${filters.from}&to=${filters.to}`}
                                className="font-medium text-slate-900 hover:text-brand-700 hover:underline"
                              >
                                {node.label}
                              </Link>
                            ) : (
                              <span
                                className={
                                  depth === 0
                                    ? "font-medium text-slate-900"
                                    : "text-slate-700"
                                }
                              >
                                {node.label}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {formatMinutes(node.loggedMinutes)}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                          {node.units === 0 ? (
                            <span className="text-slate-300">—</span>
                          ) : (
                            node.units
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">
                          {formatDuration(node.secondsPerUnit)}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">
                          {node.amount === null ? (
                            <span className="text-slate-300">—</span>
                          ) : (
                            formatUSD(node.amount)
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">
                          {node.estimatedMinutes === 0 ? (
                            <span className="text-slate-300">—</span>
                          ) : (
                            formatMinutes(node.estimatedMinutes)
                          )}
                        </td>
                        <td
                          className={`px-4 py-2.5 text-right font-medium tabular-nums ${efficiencyTone(node.efficiencyRate)}`}
                        >
                          {rate(node.efficiencyRate)}
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
              <tfoot className="border-t-2 border-slate-200 bg-slate-50">
                <tr className="font-semibold text-slate-900">
                  <td className="px-4 py-3">Total</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatMinutes(total?.loggedMinutes ?? 0)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {total?.units ?? 0}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatDuration(total?.secondsPerUnit ?? null)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {total?.amount ? formatUSD(total.amount) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatMinutes(total?.estimatedMinutes ?? 0)}
                  </td>
                  <td
                    className={`px-4 py-3 text-right tabular-nums ${efficiencyTone(total?.efficiencyRate ?? null)}`}
                  >
                    {rate(total?.efficiencyRate ?? null)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </AnalyticsPage>
  );
}
