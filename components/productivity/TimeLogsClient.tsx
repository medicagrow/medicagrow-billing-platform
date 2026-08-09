"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { MultiSelectDropdown } from "@/components/ui/MultiSelectDropdown";
import { isPageSize, Pagination } from "@/components/ui/Pagination";
import { downloadCsv } from "@/lib/csv-export";
import { useFilterState } from "@/lib/hooks/useFilterState";
import { useLocalSetting } from "@/lib/hooks/useLocalSetting";
import { usePractice } from "@/lib/contexts/PracticeContext";
import { formatDateIST, formatTimeIST } from "@/lib/timezone";
import { TaskStatus } from "@/lib/generated/prisma/enums";
import { resolvePreset, toDateParam } from "@/lib/productivity/date-ranges";
import { formatMinutes } from "@/lib/task-timer-serialize";
import type { TimeLogSummary } from "@/lib/time-analysis";
import { cn } from "@/lib/utils";

interface Option {
  id: string;
  name: string;
}

interface SessionRow {
  id: string;
  taskId: string;
  taskLabel: string;
  practiceName: string | null;
  userId: string;
  userName: string;
  startedAt: string;
  stoppedAt: string | null;
  durationMinutes: number | null;
  isEdited: boolean;
  editNote: string | null;
  originalDurationMinutes: number | null;
  estimatedMinutes: number | null;
  contributedToOverrun: boolean;
}

type Preset = "today" | "this_week" | "this_month" | "last_month" | "custom";

const PRESETS: { value: Preset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "this_week", label: "This Week" },
  { value: "this_month", label: "This Month" },
  { value: "last_month", label: "Last Month" },
  { value: "custom", label: "Custom" },
];

type Tab = "biller" | "taskType" | "overrun";

const TABS: { value: Tab; label: string }[] = [
  { value: "biller", label: "By Biller" },
  { value: "taskType", label: "By Task Type" },
  { value: "overrun", label: "Overrun Tasks" },
];

const EMPTY_SUMMARY: TimeLogSummary = {
  totalLoggedMinutes: 0,
  totalEstimatedMinutes: 0,
  efficiencyRate: null,
  overrunTaskCount: 0,
  sessionCount: 0,
  byBiller: [],
  byPractice: [],
  byTaskType: [],
  overrunTasks: [],
};

/**
 * Efficiency reads as logged ÷ estimated, so **lower is better** — under the
 * estimate is green, over it is amber, and well over is red. The thresholds
 * are the ones the operations team already uses in review.
 */
function efficiencyTone(rate: number | null): string {
  if (rate === null) return "text-slate-400";
  if (rate < 100) return "text-emerald-600";
  if (rate <= 120) return "text-amber-600";
  return "text-red-600";
}

function formatRate(rate: number | null): string {
  return rate === null ? "—" : `${rate.toFixed(1)}%`;
}

/** A modest overrun is worth noting; a large one is worth acting on. */
function overrunTone(percent: number): string {
  return percent > 20 ? "text-red-600" : "text-amber-600";
}

/** Session clock times, in the timezone the team actually works in. */
function formatTime(value: string | null): string {
  return formatTimeIST(value);
}

function SummaryCard({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-card">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p
        className={cn(
          "mt-1 text-2xl font-semibold tabular-nums",
          tone ?? "text-slate-900",
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

export function TimeLogsClient({
  billers,
  practices,
  taskTypes,
  initialUserIds = [],
  initialPracticeIds = [],
  initialTaskTypeIds = [],
  initialFrom,
  initialTo,
}: {
  billers: Option[];
  practices: Option[];
  taskTypes: Option[];
  /**
   * Seeded from the URL when someone arrives from the productivity table,
   * which links to one person's time on one type of task.
   */
  initialUserIds?: string[];
  initialPracticeIds?: string[];
  initialTaskTypeIds?: string[];
  initialFrom?: string;
  initialTo?: string;
}) {
  const { selectedPracticeId } = usePractice();

  // A window supplied in the link is a custom range; otherwise, this week.
  const linked = Boolean(initialFrom && initialTo);
  const fallback = resolvePreset("this_week");

  const startFrom = initialFrom ?? toDateParam(fallback.from);
  const startTo = initialTo ?? toDateParam(fallback.to);

  /**
   * The whole filter set lives in the URL: this report is something people
   * send each other, and a link that opens on somebody else's screen showing
   * a different fortnight is worse than no link.
   */
  const [filters, setFilters, clearFilters] = useFilterState(
    {
      preset: (linked ? "custom" : "this_week") as string,
      from: startFrom,
      to: startTo,
      userIds: initialUserIds,
      practiceIds: initialPracticeIds,
      taskTypeIds: initialTaskTypeIds,
      page: 1,
    },
    { pageKey: "page" },
  );

  const preset = filters.preset as Preset;
  const appliedFrom = filters.from;
  const appliedTo = filters.to;
  const userIds = filters.userIds;
  const practiceIds = filters.practiceIds;
  const taskTypeIds = filters.taskTypeIds;
  const page = filters.page;

  // What the custom date boxes show while they are being edited — only
  // "Apply" moves the range the report is actually built from.
  const [customFrom, setCustomFrom] = useState(startFrom);
  const [customTo, setCustomTo] = useState(startTo);

  const [tab, setTab] = useState<Tab>("biller");
  const [expandedBillers, setExpandedBillers] = useState<string[]>([]);
  const [overrunActiveOnly, setOverrunActiveOnly] = useState(true);

  const [summary, setSummary] = useState<TimeLogSummary>(EMPTY_SUMMARY);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [totalPages, setTotalPages] = useState(1);
  const [pageSize, setPageSize] = useLocalSetting(
    "timeLogs.sessions.pageSize",
    50,
    isPageSize,
  );
  const [totalSessions, setTotalSessions] = useState(0);

  function applyPreset(next: Preset) {
    if (next === "custom") {
      setFilters({ preset: next, from: customFrom, to: customTo });
      return;
    }

    // A named period resolves to real dates, so the URL carries the window
    // rather than a word whose meaning moves with the calendar.
    const range = resolvePreset(next);

    setFilters({
      preset: next,
      from: toDateParam(range.from),
      to: toDateParam(range.to),
    });
  }

  /**
   * The local practice filter wins when set; otherwise the top-bar selection
   * applies, matching how every other report on the platform behaves.
   */
  const effectivePracticeIds = useMemo(
    () =>
      practiceIds.length > 0
        ? practiceIds
        : selectedPracticeId
          ? [selectedPracticeId]
          : [],
    [practiceIds, selectedPracticeId],
  );

  const query = useMemo(() => {
    const params = new URLSearchParams({ from: appliedFrom, to: appliedTo });

    if (userIds.length > 0) params.set("userIds", userIds.join(","));
    if (effectivePracticeIds.length > 0) {
      params.set("practiceIds", effectivePracticeIds.join(","));
    }
    if (taskTypeIds.length > 0) params.set("taskTypeIds", taskTypeIds.join(","));

    return params.toString();
  }, [appliedFrom, appliedTo, userIds, effectivePracticeIds, taskTypeIds]);

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/time-logs/summary?${query}`);
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setError(payload?.error ?? "Could not load the time summary.");
        setSummary(EMPTY_SUMMARY);
        return;
      }

      setSummary(payload as TimeLogSummary);
    } catch {
      setError("Could not load the time summary. Check your connection.");
      setSummary(EMPTY_SUMMARY);
    } finally {
      setSummaryLoading(false);
    }
  }, [query]);

  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);

    try {
      const response = await fetch(
        `/api/time-logs/sessions?${query}&page=${page}&pageSize=${pageSize}`,
      );
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setSessions([]);
        return;
      }

      setSessions(payload.data as SessionRow[]);
      setTotalPages(payload.pagination.totalPages);
      setTotalSessions(payload.pagination.total);
    } catch {
      setSessions([]);
    } finally {
      setSessionsLoading(false);
    }
  }, [query, page, pageSize]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const filtersActive =
    userIds.length > 0 ||
    practiceIds.length > 0 ||
    taskTypeIds.length > 0 ||
    preset !== "this_week";

  const overrunTasks = useMemo(
    () =>
      overrunActiveOnly
        ? summary.overrunTasks.filter(
            (task) => task.status !== TaskStatus.CLOSED,
          )
        : summary.overrunTasks,
    [summary.overrunTasks, overrunActiveOnly],
  );

  function exportSessions() {
    downloadCsv(
      `time-logs-${appliedFrom}-to-${appliedTo}.csv`,
      [
        "Date",
        "Biller",
        "Task",
        "Practice",
        "Started",
        "Stopped",
        "Duration (minutes)",
        "Estimate (minutes)",
        "Edited",
        "Original duration (minutes)",
        "Edit reason",
        "Task over estimate",
      ],
      sessions.map((row) => [
        // The IST date, matching the column on screen — not the UTC one.
        formatDateIST(row.startedAt),
        row.userName,
        row.taskLabel,
        row.practiceName ?? "",
        formatTime(row.startedAt),
        formatTime(row.stoppedAt),
        row.durationMinutes ?? "",
        row.estimatedMinutes ?? "",
        row.isEdited ? "Yes" : "No",
        row.originalDurationMinutes ?? "",
        row.editNote ?? "",
        row.contributedToOverrun ? "Yes" : "No",
      ]),
    );
  }

  return (
    <div className="space-y-5">
      {/* ------------------------------ filters ----------------------------- */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-card">
        <div>
          <label
            htmlFor="time-log-preset"
            className="mb-1 block text-xs font-medium text-slate-600"
          >
            Period
          </label>
          <Select
            id="time-log-preset"
            value={preset}
            onChange={(event) => applyPreset(event.target.value as Preset)}
            className="w-auto min-w-[150px]"
          >
            {PRESETS.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </Select>
        </div>

        {preset === "custom" ? (
          <>
            <div>
              <label
                htmlFor="time-log-from"
                className="mb-1 block text-xs font-medium text-slate-600"
              >
                From
              </label>
              <Input
                id="time-log-from"
                type="date"
                value={customFrom}
                max={customTo}
                onChange={(event) => setCustomFrom(event.target.value)}
                className="w-auto"
              />
            </div>
            <div>
              <label
                htmlFor="time-log-to"
                className="mb-1 block text-xs font-medium text-slate-600"
              >
                To
              </label>
              <Input
                id="time-log-to"
                type="date"
                value={customTo}
                min={customFrom}
                onChange={(event) => setCustomTo(event.target.value)}
                className="w-auto"
              />
            </div>
            <Button
              variant="secondary"
              className="px-3 py-2 text-xs"
              disabled={!customFrom || !customTo || customFrom > customTo}
              onClick={() =>
                setFilters({ from: customFrom, to: customTo })
              }
            >
              Apply
            </Button>
          </>
        ) : (
          <p className="pb-2 text-xs text-slate-500">
            {appliedFrom} → {appliedTo}
          </p>
        )}

        <div className="min-w-[170px]">
          <label className="mb-1 block text-xs font-medium text-slate-600">
            Biller
          </label>
          <MultiSelectDropdown
            options={billers.map((biller) => ({
              value: biller.id,
              label: biller.name,
            }))}
            selected={userIds}
            onChange={(next) => setFilters({ userIds: next })}
            placeholder="All Billers"
            allLabel="All Billers"
            noun="billers"
            aria-label="Filter by biller"
          />
        </div>

        <div className="min-w-[170px]">
          <label className="mb-1 block text-xs font-medium text-slate-600">
            Practice
          </label>
          <MultiSelectDropdown
            options={practices.map((practice) => ({
              value: practice.id,
              label: practice.name,
            }))}
            selected={practiceIds}
            onChange={(next) => setFilters({ practiceIds: next })}
            placeholder="All Practices"
            allLabel="All Practices"
            noun="practices"
            aria-label="Filter by practice"
          />
        </div>

        <div className="min-w-[170px]">
          <label className="mb-1 block text-xs font-medium text-slate-600">
            Task type
          </label>
          <MultiSelectDropdown
            options={taskTypes.map((type) => ({
              value: type.id,
              label: type.name,
            }))}
            selected={taskTypeIds}
            onChange={(next) => setFilters({ taskTypeIds: next })}
            placeholder="All Task Types"
            allLabel="All Task Types"
            noun="types"
            aria-label="Filter by task type"
          />
        </div>

        {filtersActive ? (
          <Button
            variant="secondary"
            className="px-3 py-2 text-xs"
            onClick={clearFilters}
          >
            Clear filters
          </Button>
        ) : null}
      </div>

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {/* --------------------------- summary cards -------------------------- */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          label="Total hours logged"
          value={formatMinutes(summary.totalLoggedMinutes)}
          hint={`Estimated ${formatMinutes(summary.totalEstimatedMinutes)}`}
        />
        <SummaryCard
          label="Total sessions"
          value={String(summary.sessionCount)}
        />
        <SummaryCard
          label="Overall efficiency rate"
          value={formatRate(summary.efficiencyRate)}
          tone={efficiencyTone(summary.efficiencyRate)}
          hint="Logged ÷ estimated"
        />
        <SummaryCard
          label="Tasks over estimate"
          value={String(summary.overrunTaskCount)}
          tone={summary.overrunTaskCount > 0 ? "text-amber-600" : undefined}
        />
      </div>

      {/* ------------------------------- tabs ------------------------------- */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-card">
        <div className="flex gap-1 border-b border-slate-200 px-2 pt-2">
          {TABS.map((entry) => (
            <button
              key={entry.value}
              type="button"
              onClick={() => setTab(entry.value)}
              className={cn(
                "rounded-t-lg px-3 py-2 text-sm font-medium",
                tab === entry.value
                  ? "bg-slate-100 text-slate-900"
                  : "text-slate-500 hover:text-slate-700",
              )}
            >
              {entry.label}
              {entry.value === "overrun" && summary.overrunTaskCount > 0
                ? ` (${summary.overrunTaskCount})`
                : ""}
            </button>
          ))}
        </div>

        <div className="p-4">
          {summaryLoading ? (
            <p className="py-6 text-center text-sm text-slate-500">Loading…</p>
          ) : tab === "biller" ? (
            summary.byBiller.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500">
                No time logged in this period.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                      <th className="py-2 pr-3 font-medium">Biller</th>
                      <th className="py-2 pr-3 text-right font-medium">
                        Logged
                      </th>
                      <th className="py-2 pr-3 text-right font-medium">
                        Estimated
                      </th>
                      <th className="py-2 pr-3 text-right font-medium">
                        Efficiency
                      </th>
                      <th className="py-2 pr-3 text-right font-medium">
                        Sessions
                      </th>
                      <th className="py-2 text-right font-medium">Overruns</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.byBiller.map((biller) => {
                      const expanded = expandedBillers.includes(biller.userId);

                      return [
                        <tr
                          key={biller.userId}
                          className="border-b border-slate-100"
                        >
                          <td className="py-2 pr-3">
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedBillers((current) =>
                                  current.includes(biller.userId)
                                    ? current.filter(
                                        (id) => id !== biller.userId,
                                      )
                                    : [...current, biller.userId],
                                )
                              }
                              className="flex items-center gap-1.5 font-medium text-slate-900 hover:text-brand-600"
                              aria-expanded={expanded}
                            >
                              <span className="text-slate-400">
                                {expanded ? "▾" : "▸"}
                              </span>
                              {biller.userName}
                            </button>
                          </td>
                          <td className="py-2 pr-3 text-right tabular-nums">
                            {formatMinutes(biller.totalLoggedMinutes)}
                          </td>
                          <td className="py-2 pr-3 text-right tabular-nums text-slate-600">
                            {biller.totalEstimatedMinutes === 0
                              ? "—"
                              : formatMinutes(biller.totalEstimatedMinutes)}
                          </td>
                          <td
                            className={cn(
                              "py-2 pr-3 text-right font-medium tabular-nums",
                              efficiencyTone(biller.efficiencyRate),
                            )}
                          >
                            {formatRate(biller.efficiencyRate)}
                          </td>
                          <td className="py-2 pr-3 text-right tabular-nums text-slate-600">
                            {biller.sessionCount}
                          </td>
                          <td className="py-2 text-right tabular-nums">
                            {biller.overrunCount === 0 ? (
                              <span className="text-slate-400">0</span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  setFilters({ userIds: [biller.userId] });
                                  setTab("overrun");
                                }}
                                className="font-medium text-amber-600 underline-offset-2 hover:underline"
                              >
                                {biller.overrunCount}
                              </button>
                            )}
                          </td>
                        </tr>,
                        expanded ? (
                          <tr
                            key={`${biller.userId}-types`}
                            className="border-b border-slate-100 bg-slate-50/60"
                          >
                            <td colSpan={6} className="px-4 py-2">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="text-left uppercase tracking-wide text-slate-400">
                                    <th className="py-1 pr-3 font-medium">
                                      Task type
                                    </th>
                                    <th className="py-1 pr-3 text-right font-medium">
                                      Tasks
                                    </th>
                                    <th className="py-1 pr-3 text-right font-medium">
                                      Logged
                                    </th>
                                    <th className="py-1 pr-3 text-right font-medium">
                                      Estimated
                                    </th>
                                    <th className="py-1 text-right font-medium">
                                      Efficiency
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {biller.byTaskType.map((type) => (
                                    <tr key={type.taskTypeName}>
                                      <td className="py-1 pr-3 text-slate-700">
                                        {type.taskTypeName}
                                      </td>
                                      <td className="py-1 pr-3 text-right tabular-nums text-slate-600">
                                        {type.taskCount}
                                      </td>
                                      <td className="py-1 pr-3 text-right tabular-nums text-slate-700">
                                        {formatMinutes(type.loggedMinutes)}
                                      </td>
                                      <td className="py-1 pr-3 text-right tabular-nums text-slate-600">
                                        {type.estimatedMinutes === 0
                                          ? "—"
                                          : formatMinutes(type.estimatedMinutes)}
                                      </td>
                                      <td
                                        className={cn(
                                          "py-1 text-right font-medium tabular-nums",
                                          efficiencyTone(type.efficiencyRate),
                                        )}
                                      >
                                        {formatRate(type.efficiencyRate)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        ) : null,
                      ];
                    })}
                  </tbody>
                </table>
              </div>
            )
          ) : tab === "taskType" ? (
            summary.byTaskType.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500">
                No time logged in this period.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                      <th className="py-2 pr-3 font-medium">Task type</th>
                      <th className="py-2 pr-3 text-right font-medium">Tasks</th>
                      <th className="py-2 pr-3 text-right font-medium">
                        Billers
                      </th>
                      <th className="py-2 pr-3 text-right font-medium">
                        Total logged
                      </th>
                      <th className="py-2 pr-3 text-right font-medium">
                        Avg logged
                      </th>
                      <th className="py-2 pr-3 text-right font-medium">
                        Avg estimated
                      </th>
                      <th className="py-2 text-right font-medium">Efficiency</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.byTaskType.map((type) => (
                      <tr
                        key={type.taskTypeId}
                        className="border-b border-slate-100"
                      >
                        <td className="py-2 pr-3 font-medium text-slate-900">
                          {type.taskTypeName}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums text-slate-600">
                          {type.taskCount}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums text-slate-600">
                          {type.billerCount}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {formatMinutes(type.totalLoggedMinutes)}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums text-slate-600">
                          {formatMinutes(type.avgLoggedMinutes)}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums text-slate-600">
                          {type.avgEstimatedMinutes === 0
                            ? "—"
                            : formatMinutes(type.avgEstimatedMinutes)}
                        </td>
                        <td
                          className={cn(
                            "py-2 text-right font-medium tabular-nums",
                            efficiencyTone(type.efficiencyRate),
                          )}
                        >
                          {formatRate(type.efficiencyRate)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : (
            <>
              <div className="mb-3 flex items-center gap-2">
                <Button
                  variant={overrunActiveOnly ? "primary" : "secondary"}
                  className="px-3 py-1.5 text-xs"
                  onClick={() => setOverrunActiveOnly(true)}
                >
                  Active only
                </Button>
                <Button
                  variant={overrunActiveOnly ? "secondary" : "primary"}
                  className="px-3 py-1.5 text-xs"
                  onClick={() => setOverrunActiveOnly(false)}
                >
                  All
                </Button>
              </div>

              {overrunTasks.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-500">
                  {overrunActiveOnly
                    ? "No open task is over its estimate."
                    : "No task is over its estimate."}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                        <th className="py-2 pr-3 font-medium">Task</th>
                        <th className="py-2 pr-3 font-medium">Practice</th>
                        <th className="py-2 pr-3 font-medium">Assigned to</th>
                        <th className="py-2 pr-3 text-right font-medium">
                          Estimated
                        </th>
                        <th className="py-2 pr-3 text-right font-medium">
                          Logged
                        </th>
                        <th className="py-2 pr-3 text-right font-medium">
                          Over by
                        </th>
                        <th className="py-2 pr-3 text-right font-medium">
                          Over %
                        </th>
                        <th className="py-2 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overrunTasks.map((task) => (
                        <tr
                          key={task.taskId}
                          className="border-b border-slate-100"
                        >
                          <td className="py-2 pr-3 font-medium text-slate-900">
                            {task.taskLabel}
                          </td>
                          <td className="py-2 pr-3 text-slate-600">
                            {task.practiceName}
                          </td>
                          <td className="py-2 pr-3 text-slate-600">
                            {task.assignedToName}
                          </td>
                          <td className="py-2 pr-3 text-right tabular-nums text-slate-600">
                            {formatMinutes(task.estimatedMinutes)}
                          </td>
                          <td className="py-2 pr-3 text-right tabular-nums">
                            {formatMinutes(task.loggedMinutes)}
                          </td>
                          <td className="py-2 pr-3 text-right tabular-nums text-slate-600">
                            {formatMinutes(task.overrunMinutes)}
                          </td>
                          <td
                            className={cn(
                              "py-2 pr-3 text-right font-medium tabular-nums",
                              overrunTone(task.overrunPercent),
                            )}
                          >
                            +{task.overrunPercent.toFixed(1)}%
                          </td>
                          <td className="py-2 text-slate-600">{task.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ---------------------------- session log --------------------------- */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-card">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Session log</h2>
            <p className="text-xs text-slate-500">
              {totalSessions} session{totalSessions === 1 ? "" : "s"} in this
              period
            </p>
          </div>
          <Button
            variant="secondary"
            className="px-3 py-1.5 text-xs"
            onClick={exportSessions}
            disabled={sessions.length === 0}
          >
            Export CSV
          </Button>
        </div>

        {sessionsLoading ? (
          <p className="py-6 text-center text-sm text-slate-500">Loading…</p>
        ) : sessions.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">
            No sessions match these filters.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="py-2 pr-3 font-medium">Date</th>
                    <th className="py-2 pr-3 font-medium">Biller</th>
                    <th className="py-2 pr-3 font-medium">Task</th>
                    <th className="py-2 pr-3 font-medium">Practice</th>
                    <th className="py-2 pr-3 font-medium">Time</th>
                    <th className="py-2 pr-3 text-right font-medium">
                      Duration
                    </th>
                    <th className="py-2 pr-3 text-right font-medium">
                      Estimate
                    </th>
                    <th className="py-2 font-medium">Flags</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((row) => (
                    <tr key={row.id} className="border-b border-slate-100">
                      <td className="py-2 pr-3 whitespace-nowrap text-slate-600">
                        {formatDateIST(row.startedAt)}
                      </td>
                      <td className="py-2 pr-3 text-slate-700">
                        {row.userName}
                      </td>
                      <td className="py-2 pr-3 font-medium text-slate-900">
                        {row.taskLabel}
                      </td>
                      <td className="py-2 pr-3 text-slate-600">
                        {row.practiceName ?? "—"}
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap tabular-nums text-slate-600">
                        {formatTime(row.startedAt)} – {formatTime(row.stoppedAt)}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {formatMinutes(row.durationMinutes)}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-slate-600">
                        {row.estimatedMinutes === null
                          ? "—"
                          : formatMinutes(row.estimatedMinutes)}
                      </td>
                      <td className="py-2">
                        <div className="flex flex-wrap gap-1">
                          {row.isEdited ? (
                            <span
                              className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700"
                              title={[
                                `Originally ${formatMinutes(row.originalDurationMinutes)}`,
                                row.editNote,
                              ]
                                .filter(Boolean)
                                .join(" — ")}
                            >
                              Edited (was{" "}
                              {formatMinutes(row.originalDurationMinutes)})
                            </span>
                          ) : null}
                          {row.contributedToOverrun ? (
                            <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700">
                              Over estimate
                            </span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Pagination
              currentPage={page}
              totalPages={totalPages}
              totalItems={totalSessions}
              pageSize={pageSize}
              onPageChange={(next) => setFilters({ page: next })}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setFilters({ page: 1 });
              }}
              noun="sessions"
              filtered={filtersActive}
            />
          </>
        )}
      </div>
    </div>
  );
}
