"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/Card";
import { Pagination } from "@/components/ui/Pagination";
import { TableSkeleton } from "@/components/ui/Skeleton";
import {
  analyticsQuery,
  AnalyticsPage,
  useAnalyticsData,
  useAnalyticsFilters,
} from "@/components/analytics/AnalyticsShell";
import type { AnalyticsOption } from "@/components/analytics/AnalyticsFilters";
import { downloadCsv } from "@/lib/csv-export";
import { formatUSD } from "@/lib/format";
import { useLocalSetting } from "@/lib/hooks/useLocalSetting";
import { formatMinutes } from "@/lib/task-timer-serialize";
import { formatDateTimeIST, formatTimeIST } from "@/lib/timezone";
import { FLAG_LABELS, type SuspiciousFlag } from "@/lib/analytics/flags";

interface SessionRow {
  id: string;
  taskId: string;
  taskLabel: string;
  practiceId: string | null;
  practiceName: string | null;
  taskTypeName: string | null;
  billerId: string;
  billerName: string;
  startedAt: string;
  stoppedAt: string | null;
  durationMinutes: number;
  estimatedMinutes: number | null;
  efficiencyRate: number | null;
  productivityCount: number | null;
  productivityAmount: string | null;
  isEdited: boolean;
  editNote: string | null;
  originalDurationMinutes: number | null;
  isFlagged: boolean;
  flagType: SuspiciousFlag | null;
}

interface SessionLogResponse {
  data: SessionRow[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

const SORTS = [
  { value: "startedAt", label: "Started" },
  { value: "duration", label: "Duration" },
  { value: "biller", label: "Biller" },
  { value: "practice", label: "Practice" },
  { value: "taskType", label: "Task type" },
] as const;

type SortKey = (typeof SORTS)[number]["value"];

function efficiencyTone(value: number | null): string {
  if (value === null) return "text-slate-400";
  if (value < 100) return "text-emerald-600";
  if (value <= 120) return "text-amber-600";
  return "text-red-600";
}

export function SessionLogClient({
  options,
}: {
  options: {
    billers: AnalyticsOption[];
    practices: AnalyticsOption[];
    taskTypes: AnalyticsOption[];
  };
}) {
  const [filters, setFilters, clearFilters] = useAnalyticsFilters();

  // Sort, paging and the two toggles are page state rather than shared filter
  // state, so they stay out of the shared defaults every other report reads.
  const [sort, setSort] = useState<SortKey>("startedAt");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [editedOnly, setEditedOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useLocalSetting("session-log:page-size", 50);
  const [open, setOpen] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const query = useMemo(
    () =>
      analyticsQuery(filters, {
        sort,
        direction,
        flaggedOnly: flaggedOnly ? "true" : undefined,
        editedOnly: editedOnly ? "true" : undefined,
        page: String(page),
        pageSize: String(pageSize),
      }),
    [filters, sort, direction, flaggedOnly, editedOnly, page, pageSize],
  );

  const { data, loading, error } = useAnalyticsData<SessionLogResponse>(
    "/api/analytics/session-log",
    query,
  );

  const rows = data?.data ?? [];
  const meta = data?.pagination;

  function chooseSort(next: SortKey) {
    if (next === sort) {
      setDirection((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSort(next);
      setDirection(next === "startedAt" || next === "duration" ? "desc" : "asc");
    }
    setPage(1);
  }

  /**
   * The export covers every matching session, not the page on screen — the
   * reason to export is to work outside the app, and a 50-row slice of a
   * month's timers is not that. Capped at the API's own maximum page size, so
   * it is one request rather than an unbounded loop.
   */
  async function exportCsv() {
    setExporting(true);

    try {
      const params = analyticsQuery(filters, {
        sort,
        direction,
        flaggedOnly: flaggedOnly ? "true" : undefined,
        editedOnly: editedOnly ? "true" : undefined,
        page: "1",
        pageSize: "500",
      });

      const response = await fetch(`/api/analytics/session-log?${params}`);
      if (!response.ok) return;

      const payload = (await response.json()) as SessionLogResponse;

      downloadCsv(
        `session-log-${filters.from}-to-${filters.to}.csv`,
        [
          "Started (IST)",
          "Stopped (IST)",
          "Biller",
          "Practice",
          "Task type",
          "Task",
          "Duration (minutes)",
          "Estimated (minutes)",
          "Efficiency %",
          "Units",
          "Amount",
          "Edited",
          "Original duration",
          "Edit note",
          "Flag",
        ],
        payload.data.map((row) => [
          formatDateTimeIST(row.startedAt),
          formatDateTimeIST(row.stoppedAt),
          row.billerName,
          row.practiceName ?? "",
          row.taskTypeName ?? "",
          row.taskLabel,
          row.durationMinutes,
          row.estimatedMinutes ?? "",
          row.efficiencyRate ?? "",
          row.productivityCount ?? "",
          row.productivityAmount ?? "",
          row.isEdited ? "Yes" : "No",
          row.originalDurationMinutes ?? "",
          row.editNote ?? "",
          row.flagType ? FLAG_LABELS[row.flagType] : "",
        ]),
      );
    } finally {
      setExporting(false);
    }
  }

  const totalMinutes = rows.reduce((sum, row) => sum + row.durationMinutes, 0);
  const editedCount = rows.filter((row) => row.isEdited).length;
  const flaggedCount = rows.filter((row) => row.isFlagged).length;

  return (
    <AnalyticsPage
      title="Session Log"
      description="Every timer session behind the numbers, with the edits and flags against each."
      filters={filters}
      setFilters={(updates) => {
        setPage(1);
        setFilters(updates);
      }}
      clearFilters={clearFilters}
      options={options}
      error={error}
      filterExtras={
        <div className="flex items-center gap-4 pb-2">
          <label className="flex items-center gap-1.5 text-xs text-slate-700">
            <input
              type="checkbox"
              checked={flaggedOnly}
              onChange={(event) => {
                setFlaggedOnly(event.target.checked);
                setPage(1);
              }}
              className="h-4 w-4 rounded border-slate-300 text-brand-600"
            />
            Flagged only
          </label>
          <label className="flex items-center gap-1.5 text-xs text-slate-700">
            <input
              type="checkbox"
              checked={editedOnly}
              onChange={(event) => {
                setEditedOnly(event.target.checked);
                setPage(1);
              }}
              className="h-4 w-4 rounded border-slate-300 text-brand-600"
            />
            Edited only
          </label>
        </div>
      }
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-card">
        <p className="text-sm text-slate-700">
          <span className="font-semibold text-slate-900">
            {meta?.total ?? 0}
          </span>{" "}
          sessions · {formatMinutes(totalMinutes)} on this page ·{" "}
          {editedCount} edited · {flaggedCount} flagged
        </p>
        <Button
          variant="secondary"
          className="px-3 py-2 text-xs"
          onClick={exportCsv}
          disabled={exporting || loading}
        >
          {exporting ? "Preparing…" : "Export CSV"}
        </Button>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-card">
        {loading ? (
          <div className="p-4">
            <TableSkeleton rows={8} columns={7} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No sessions match"
            description="Widen the dates, or turn off a toggle."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  {SORTS.map((column) => (
                    <th key={column.value} className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => chooseSort(column.value)}
                        className="flex items-center gap-1 hover:text-slate-800"
                      >
                        {column.label}
                        {sort === column.value ? (
                          <span>{direction === "asc" ? "▲" : "▼"}</span>
                        ) : null}
                      </button>
                    </th>
                  ))}
                  <th className="px-4 py-3">Task</th>
                  <th className="px-4 py-3 text-right">vs estimate</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => {
                  const expanded = open === row.id;

                  return (
                    <Fragment key={row.id}>
                      <tr
                        className={
                          row.isFlagged ? "bg-amber-50/50" : undefined
                        }
                      >
                        <td className="px-4 py-2.5 text-slate-700">
                          {formatDateTimeIST(row.startedAt)}
                        </td>
                        <td className="px-4 py-2.5 tabular-nums text-slate-900">
                          {formatMinutes(row.durationMinutes)}
                          {row.isEdited ? (
                            <span
                              className="ml-1 text-amber-600"
                              title="Edited after the fact"
                            >
                              ✎
                            </span>
                          ) : null}
                        </td>
                        <td className="px-4 py-2.5 font-medium text-slate-900">
                          {row.billerName}
                        </td>
                        <td className="px-4 py-2.5 text-slate-600">
                          {row.practiceName ?? "—"}
                        </td>
                        <td className="px-4 py-2.5 text-slate-600">
                          {row.taskTypeName ?? "—"}
                        </td>
                        <td className="px-4 py-2.5 text-slate-700">
                          <Link
                            href={`/tasks/${row.taskId}`}
                            className="hover:text-brand-700 hover:underline"
                          >
                            {row.taskLabel}
                          </Link>
                        </td>
                        <td
                          className={`px-4 py-2.5 text-right font-medium tabular-nums ${efficiencyTone(row.efficiencyRate)}`}
                        >
                          {row.efficiencyRate === null
                            ? "—"
                            : `${row.efficiencyRate.toFixed(1)}%`}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <button
                            type="button"
                            onClick={() => setOpen(expanded ? null : row.id)}
                            aria-expanded={expanded}
                            className="text-xs font-medium text-brand-600 hover:underline"
                          >
                            {expanded ? "Hide" : "Details"}
                          </button>
                        </td>
                      </tr>

                      {expanded ? (
                        <tr className="bg-slate-50/70">
                          <td colSpan={8} className="px-4 py-3">
                            <div className="grid gap-4 text-xs sm:grid-cols-3">
                              <div>
                                <p className="font-medium text-slate-700">
                                  Session
                                </p>
                                <p className="mt-1 text-slate-600">
                                  {formatTimeIST(row.startedAt)} →{" "}
                                  {row.stoppedAt
                                    ? formatTimeIST(row.stoppedAt)
                                    : "still running"}
                                </p>
                                <p className="text-slate-600">
                                  Estimated{" "}
                                  {row.estimatedMinutes === null
                                    ? "—"
                                    : formatMinutes(row.estimatedMinutes)}
                                </p>
                              </div>

                              <div>
                                <p className="font-medium text-slate-700">
                                  Output
                                </p>
                                <p className="mt-1 text-slate-600">
                                  {row.productivityCount ?? "—"} units
                                </p>
                                <p className="text-slate-600">
                                  {row.productivityAmount
                                    ? formatUSD(row.productivityAmount)
                                    : "No amount recorded"}
                                </p>
                              </div>

                              <div>
                                <p className="font-medium text-slate-700">
                                  Edits and flags
                                </p>
                                {row.isEdited ? (
                                  <p className="mt-1 text-slate-600">
                                    Changed from{" "}
                                    {row.originalDurationMinutes === null
                                      ? "—"
                                      : formatMinutes(
                                          row.originalDurationMinutes,
                                        )}
                                    {row.editNote ? ` — "${row.editNote}"` : ""}
                                  </p>
                                ) : (
                                  <p className="mt-1 text-slate-500">
                                    Never edited.
                                  </p>
                                )}
                                {row.flagType ? (
                                  <p className="mt-1">
                                    <Badge variant="amber">
                                      {FLAG_LABELS[row.flagType]}
                                    </Badge>
                                  </p>
                                ) : null}
                              </div>
                            </div>
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

        {meta && meta.total > 0 ? (
          <Pagination
            currentPage={meta.page}
            totalPages={meta.totalPages}
            totalItems={meta.total}
            pageSize={meta.pageSize}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
            noun="sessions"
          />
        ) : null}
      </div>
    </AnalyticsPage>
  );
}
