"use client";

import { useMemo, useState } from "react";
import { Badge, type BadgeVariant } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/Card";
import { Textarea } from "@/components/ui/Select";
import { TableSkeleton } from "@/components/ui/Skeleton";
import {
  analyticsQuery,
  AnalyticsPage,
  SummaryCard,
  useAnalyticsData,
  useAnalyticsFilters,
} from "@/components/analytics/AnalyticsShell";
import type { AnalyticsOption } from "@/components/analytics/AnalyticsFilters";
import { formatDateTimeIST } from "@/lib/timezone";
import { formatMinutes } from "@/lib/task-timer-serialize";
import {
  FLAG_LABELS,
  FLAG_TYPES,
  THRESHOLDS,
  type DetectedPattern,
  type FlaggedSession,
  type SuspiciousActivityResult,
  type SuspiciousFlag,
} from "@/lib/analytics/flags";

const FLAG_TONE: Record<SuspiciousFlag, BadgeVariant> = {
  SHORT_TIMER: "amber",
  EXTREME_OVERRUN: "red",
  NO_PRODUCTIVITY: "violet",
  PATTERN: "sky",
};

/** Why this one was flagged, in the words the thresholds imply. */
function reasonFor(session: FlaggedSession): string {
  switch (session.flagType) {
    case "SHORT_TIMER":
      return `The timer ran ${formatMinutes(session.loggedMinutes)} against an estimate of ${formatMinutes(session.estimatedMinutes ?? 0)}. Anything under ${THRESHOLDS.shortTimerMaxMinutes} minutes on a task estimated at ${THRESHOLDS.shortTimerMinEstimate} minutes or more is flagged.`;
    case "EXTREME_OVERRUN":
      return `The task took ${formatMinutes(session.loggedMinutes)} against an estimate of ${formatMinutes(session.estimatedMinutes ?? 0)} — ${THRESHOLDS.overrunMultiple}× the estimate or worse.`;
    case "NO_PRODUCTIVITY":
      return `The task was closed with ${formatMinutes(session.loggedMinutes)} logged but no units recorded against it.`;
    default:
      return "";
  }
}

export function SuspiciousActivityClient({
  options,
  currentUserId,
}: {
  options: {
    billers: AnalyticsOption[];
    practices: AnalyticsOption[];
    taskTypes: AnalyticsOption[];
  };
  currentUserId: string;
}) {
  const [filters, setFilters, clearFilters] = useAnalyticsFilters();
  const [flagType, setFlagType] = useState<SuspiciousFlag | null>(null);
  const [reviewing, setReviewing] = useState<FlaggedSession | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [raised, setRaised] = useState<string[]>([]);

  const query = useMemo(() => analyticsQuery(filters), [filters]);

  const { data, loading, error, reload } =
    useAnalyticsData<SuspiciousActivityResult>(
      "/api/analytics/suspicious-activity",
      query,
    );

  /**
   * The cards narrow the table on the client rather than re-querying: the
   * request already carries every flag type, and a click that only hides rows
   * should not cost a round trip.
   */
  const sessions = useMemo(() => {
    const rows = data?.sessions ?? [];
    return flagType ? rows.filter((row) => row.flagType === flagType) : rows;
  }, [data, flagType]);

  async function dismiss(session: FlaggedSession, dismissed: boolean) {
    setSaving(true);
    setActionError(null);

    try {
      const response = await fetch("/api/analytics/suspicious-activity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          flagKey: session.flagKey,
          flagType: session.flagType,
          note: note.trim() || undefined,
          dismissed,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setActionError(payload?.error ?? "Could not save that.");
        return;
      }

      setReviewing(null);
      setNote("");
      await reload();
    } finally {
      setSaving(false);
    }
  }

  /**
   * A pattern worth acting on becomes a task the manager will see again,
   * carrying the same task type as the work it is about — there is no
   * dedicated "review" type, and inventing one behind the owner's back would
   * put a row in a list they curate.
   */
  async function raiseTask(pattern: DetectedPattern) {
    setSaving(true);
    setActionError(null);

    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskTypeId: pattern.taskTypeId,
          assignedToId: currentUserId,
          description:
            `Review flagged pattern: ${pattern.billerName} — ` +
            `${FLAG_LABELS[pattern.flagType]} on ${pattern.taskTypeName}, ` +
            `${pattern.occurrences} occurrences between ${pattern.dates[0]} and ` +
            `${pattern.dates[pattern.dates.length - 1]}.`,
          dueDate: new Date().toISOString().slice(0, 10),
          priority: pattern.severity === "red" ? "HIGH" : "MEDIUM",
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setActionError(payload?.error ?? "Could not create the task.");
        return;
      }

      setRaised((current) => [...current, pattern.flagKey]);
    } finally {
      setSaving(false);
    }
  }

  const summary = data?.summary;

  return (
    <AnalyticsPage
      title="Suspicious Activity"
      description="Timer behaviour worth a question — not an accusation. Every flag is recomputed from the logs, so dismissing one is a decision, not a deletion."
      filters={filters}
      setFilters={setFilters}
      clearFilters={clearFilters}
      options={options}
      error={error ?? actionError}
    >
      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {FLAG_TYPES.map((flag) => (
          <SummaryCard
            key={flag}
            label={FLAG_LABELS[flag]}
            value={String(summary?.[flag] ?? 0)}
            tone={
              (summary?.[flag] ?? 0) > 0 ? "text-slate-900" : "text-slate-400"
            }
            hint={flag === flagType ? "Filtering the table" : undefined}
            active={flag === flagType}
            onClick={
              flag === "PATTERN"
                ? undefined
                : () => setFlagType(flag === flagType ? null : flag)
            }
          />
        ))}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-card">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-900">
            Flagged sessions
            {flagType ? ` — ${FLAG_LABELS[flagType]}` : ""}
          </h3>
          {flagType ? (
            <button
              type="button"
              onClick={() => setFlagType(null)}
              className="text-xs font-medium text-slate-500 hover:text-slate-800"
            >
              Show all
            </button>
          ) : null}
        </div>

        {loading ? (
          <div className="p-4">
            <TableSkeleton rows={5} columns={6} />
          </div>
        ) : sessions.length === 0 ? (
          <EmptyState
            title="Nothing flagged in this period"
            description="Timers ran roughly as estimated, and closed work carried its counts."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Flag</th>
                  <th className="px-4 py-3">Biller</th>
                  <th className="px-4 py-3">Task</th>
                  <th className="px-4 py-3">When</th>
                  <th className="px-4 py-3 text-right">Logged</th>
                  <th className="px-4 py-3 text-right">Estimated</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sessions.map((session) => (
                  <tr
                    key={session.flagKey}
                    className={session.dismissed ? "opacity-50" : undefined}
                  >
                    <td className="px-4 py-2.5">
                      <Badge variant={FLAG_TONE[session.flagType]}>
                        {FLAG_LABELS[session.flagType]}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 font-medium text-slate-900">
                      {session.billerName}
                    </td>
                    <td className="px-4 py-2.5 text-slate-700">
                      {session.taskLabel}
                      <span className="block text-xs text-slate-400">
                        {session.practiceName ?? "No practice"} ·{" "}
                        {session.taskTypeName}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">
                      {formatDateTimeIST(session.occurredAt)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {formatMinutes(session.loggedMinutes)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">
                      {session.estimatedMinutes === null
                        ? "—"
                        : formatMinutes(session.estimatedMinutes)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {session.dismissed ? (
                        <span
                          className="text-xs text-slate-500"
                          title={
                            session.dismissedByName
                              ? `Dismissed by ${session.dismissedByName}`
                              : undefined
                          }
                        >
                          Dismissed
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setReviewing(session);
                            setNote("");
                          }}
                          className="text-xs font-medium text-brand-600 hover:underline"
                        >
                          Review
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {data && data.patterns.length > 0 ? (
        <div className="mt-5">
          <h3 className="mb-3 text-sm font-semibold text-slate-900">
            Patterns — {THRESHOLDS.patternOccurrences} or more of the same flag
            for the same person and kind of work
          </h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.patterns.map((pattern) => (
              <div
                key={pattern.flagKey}
                className={`rounded-xl border bg-white p-4 shadow-card ${
                  pattern.dismissed
                    ? "border-slate-200 opacity-60"
                    : pattern.severity === "red"
                      ? "border-red-200"
                      : "border-amber-200"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-slate-900">
                      {pattern.billerName}
                    </p>
                    <p className="text-xs text-slate-500">
                      {FLAG_LABELS[pattern.flagType]} · {pattern.taskTypeName}
                    </p>
                  </div>
                  <Badge
                    variant={pattern.severity === "red" ? "red" : "amber"}
                  >
                    {pattern.occurrences}×
                  </Badge>
                </div>

                <p className="mt-2 text-xs text-slate-500">
                  {pattern.dates.slice(0, 5).join(", ")}
                  {pattern.dates.length > 5
                    ? ` +${pattern.dates.length - 5} more`
                    : ""}
                </p>

                {pattern.dismissed ? (
                  <p className="mt-3 text-xs text-slate-500">Dismissed</p>
                ) : raised.includes(pattern.flagKey) ? (
                  <p className="mt-3 text-xs text-emerald-700">
                    Task created and assigned to you.
                  </p>
                ) : (
                  <Button
                    variant="secondary"
                    className="mt-3 px-3 py-1.5 text-xs"
                    onClick={() => raiseTask(pattern)}
                    disabled={saving || !pattern.taskTypeId}
                    title={
                      pattern.taskTypeId
                        ? undefined
                        : "This pattern has no task type, so there is nothing to file the review under."
                    }
                  >
                    Flag for review
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {reviewing ? (
        <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/30">
          <div className="h-full w-full max-w-md overflow-y-auto bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between">
              <div>
                <Badge variant={FLAG_TONE[reviewing.flagType]}>
                  {FLAG_LABELS[reviewing.flagType]}
                </Badge>
                <h3 className="mt-2 text-lg font-semibold text-slate-900">
                  {reviewing.billerName}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setReviewing(null)}
                aria-label="Close"
                className="text-slate-400 hover:text-slate-700"
              >
                ✕
              </button>
            </div>

            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Task</dt>
                <dd className="text-right text-slate-900">
                  {reviewing.taskLabel}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Practice</dt>
                <dd className="text-right text-slate-900">
                  {reviewing.practiceName ?? "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Task type</dt>
                <dd className="text-right text-slate-900">
                  {reviewing.taskTypeName}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">When</dt>
                <dd className="text-right text-slate-900">
                  {formatDateTimeIST(reviewing.occurredAt)}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Logged</dt>
                <dd className="text-right tabular-nums text-slate-900">
                  {formatMinutes(reviewing.loggedMinutes)}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Estimated</dt>
                <dd className="text-right tabular-nums text-slate-900">
                  {reviewing.estimatedMinutes === null
                    ? "—"
                    : formatMinutes(reviewing.estimatedMinutes)}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Units recorded</dt>
                <dd className="text-right tabular-nums text-slate-900">
                  {reviewing.productivityCount ?? "—"}
                </dd>
              </div>
            </dl>

            <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
              {reasonFor(reviewing)}
            </p>

            <label
              htmlFor="dismiss-note"
              className="mt-4 block text-xs font-medium text-slate-600"
            >
              Note (optional)
            </label>
            <Textarea
              id="dismiss-note"
              rows={3}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="What did you find when you asked?"
            />

            <div className="mt-4 flex gap-2">
              <Button
                onClick={() => dismiss(reviewing, true)}
                disabled={saving}
                className="flex-1"
              >
                {saving ? "Saving…" : "Dismiss flag"}
              </Button>
              <Button
                variant="secondary"
                onClick={() => setReviewing(null)}
                disabled={saving}
              >
                Cancel
              </Button>
            </div>

            <p className="mt-3 text-xs text-slate-500">
              Dismissing records your name against the decision. It stops the
              flag being shown; it does not change the time log.
            </p>
          </div>
        </div>
      ) : null}
    </AnalyticsPage>
  );
}
