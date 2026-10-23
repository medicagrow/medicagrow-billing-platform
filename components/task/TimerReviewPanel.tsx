"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/Card";
import { FieldError, Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/toast";
import { formatMinutes } from "@/lib/task-timer-serialize";
import { formatDateIST, formatTimeIST } from "@/lib/timezone";

interface OtherSession {
  logId: string;
  label: string;
  practiceName: string | null;
  startedAt: string;
  stoppedAt: string | null;
  durationMinutes: number | null;
  isPending: boolean;
}

interface ReviewRow {
  logId: string;
  billerId: string;
  billerName: string | null;
  taskId: string;
  taskLabel: string;
  practiceName: string | null;
  shiftDay: string;
  startedAt: string;
  autoStoppedAt: string | null;
  durationMinutes: number | null;
  billerNote: string | null;
  otherSessions: OtherSession[];
}

const clock = (iso: string) => formatTimeIST(iso);

/**
 * `datetime-local` wants the viewer's wall clock, and everything else in this
 * app is shown in IST. Converting here keeps the field agreeing with the times
 * printed beside it rather than with the reviewer's own timezone.
 */
function toIstInputValue(iso: string): string {
  const shifted = new Date(new Date(iso).getTime() + 5.5 * 3_600_000);
  return shifted.toISOString().slice(0, 16);
}

function fromIstInputValue(value: string): string {
  return new Date(new Date(`${value}:00.000Z`).getTime() - 5.5 * 3_600_000).toISOString();
}

/**
 * Timers the sweep had to stop, waiting for someone to say when the work
 * actually ended (01 P1-01).
 *
 * The hours in here are counted nowhere until approved, which is the point:
 * a six-day session used to land on one date and inflate every report built
 * on it. The reviewer sees the rest of that person's shift day, because "when
 * did you stop" is usually answered by what they did next.
 */
export function TimerReviewPanel() {
  const { toast } = useToast();

  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [ends, setEnds] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [problems, setProblems] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);

    try {
      const response = await fetch("/api/tasks/time-logs/timer-reviews");
      if (response.ok) {
        const payload = await response.json();
        setRows(payload.data);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function approve(row: ReviewRow) {
    setBusyId(row.logId);
    setProblems((current) => ({ ...current, [row.logId]: "" }));

    const typed = ends[row.logId];

    try {
      const response = await fetch(
        `/api/tasks/time-logs/${row.logId}/timer-review`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            newStoppedAt: typed ? fromIstInputValue(typed) : undefined,
            note: notes[row.logId]?.trim() || undefined,
          }),
        },
      );

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setProblems((current) => ({
          ...current,
          [row.logId]: payload?.error ?? "Could not approve that session.",
        }));
        return;
      }

      toast(
        `${formatMinutes(payload.durationMinutes)} approved for ${row.billerName ?? "biller"}`,
      );
      await load();
    } catch {
      setProblems((current) => ({
        ...current,
        [row.logId]: "Could not approve that session. Check your connection.",
      }));
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return <div className="h-24 animate-pulse rounded-xl bg-slate-100" />;
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        title="No timers awaiting review"
        description="Sessions stopped automatically appear here until their end time is confirmed."
      />
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        These hours are counted in no report until approved. The end time may be
        moved anywhere between the start and where the timer was stopped.
      </p>

      {rows.map((row) => (
        <article
          key={row.logId}
          className="rounded-xl border border-amber-200 bg-white p-4 shadow-card"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-medium text-slate-900">
                {row.billerName ?? "Unknown"}
                <span className="ml-2 text-sm font-normal text-slate-500">
                  {row.taskLabel}
                  {row.practiceName ? ` · ${row.practiceName}` : ""}
                </span>
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                {formatDateIST(row.startedAt)} · started {clock(row.startedAt)} ·
                stopped automatically at{" "}
                {row.autoStoppedAt ? clock(row.autoStoppedAt) : "—"}
              </p>
            </div>
            <Badge variant="amber">
              {formatMinutes(row.durationMinutes)} pending
            </Badge>
          </div>

          {row.billerNote ? (
            <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700">
              <span className="font-medium">They say:</span> {row.billerNote}
            </p>
          ) : (
            <p className="mt-2 text-xs text-slate-400">
              No note from the biller yet.
            </p>
          )}

          {row.otherSessions.length > 0 ? (
            <div className="mt-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                Their other sessions that day
              </p>
              <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                {row.otherSessions.map((other) => (
                  <li key={other.logId}>
                    {clock(other.startedAt)} →{" "}
                    {other.stoppedAt ? clock(other.stoppedAt) : "—"} ·{" "}
                    {formatMinutes(other.durationMinutes)} · {other.label}
                    {other.isPending ? (
                      <span className="ml-1 text-amber-700">(also pending)</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {problems[row.logId] ? (
            <div className="mt-2">
              <FieldError>{problems[row.logId]}</FieldError>
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="text-xs text-slate-600">
              <span className="block">Actual end time (IST)</span>
              <Input
                type="datetime-local"
                className="mt-1 w-auto"
                min={toIstInputValue(row.startedAt)}
                max={
                  row.autoStoppedAt
                    ? toIstInputValue(row.autoStoppedAt)
                    : undefined
                }
                value={ends[row.logId] ?? ""}
                onChange={(event) =>
                  setEnds((current) => ({
                    ...current,
                    [row.logId]: event.target.value,
                  }))
                }
                disabled={busyId === row.logId}
              />
            </label>

            <label className="min-w-[200px] flex-1 text-xs text-slate-600">
              <span className="block">Note (optional)</span>
              <Input
                className="mt-1"
                value={notes[row.logId] ?? ""}
                onChange={(event) =>
                  setNotes((current) => ({
                    ...current,
                    [row.logId]: event.target.value,
                  }))
                }
                placeholder="Why the time was changed"
                disabled={busyId === row.logId}
              />
            </label>

            <Button
              className="px-3 py-2 text-xs"
              onClick={() => approve(row)}
              disabled={busyId === row.logId}
            >
              {busyId === row.logId
                ? "Saving…"
                : ends[row.logId]
                  ? "Correct and approve"
                  : "Approve as is"}
            </Button>
          </div>
        </article>
      ))}
    </div>
  );
}
