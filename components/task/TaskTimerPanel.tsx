"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { FieldError, Input, Label } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/toast";
import type { TaskDto } from "@/lib/task-serialize";
import { formatMinutes, type TaskTimeLogDto } from "@/lib/task-timer-serialize";
import { formatDateIST, formatTimeIST } from "@/lib/timezone";

/** 48 hours, matching the server's edit window. */
const EDIT_WINDOW_MS = 48 * 3_600_000;

const clock = (iso: string) => formatTimeIST(iso);

/** "1h 23m 45s" — the running clock, which needs seconds. */
function elapsedLabel(fromIso: string, now: number): string {
  const seconds = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m ${rest}s`;
  if (minutes > 0) return `${minutes}m ${rest}s`;
  return `${rest}s`;
}

/** A datetime-local value for an input, in the browser's own timezone. */
function toLocalInput(iso: string): string {
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function TaskTimerPanel({
  task,
  currentUserId,
  onChanged,
}: {
  task: TaskDto;
  currentUserId: string;
  onChanged: () => void;
}) {
  const { toast } = useToast();

  const [logs, setLogs] = useState<TaskTimeLogDto[]>([]);
  const [totalMinutes, setTotalMinutes] = useState(task.totalLoggedMinutes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<TaskTimeLogDto | null>(null);

  // Re-rendered every second only while a timer is running here.
  const [now, setNow] = useState(() => Date.now());

  const runningHere = task.activeTimerStartedAt !== null;
  const mine = runningHere && task.activeTimerUserId === currentUserId;

  useEffect(() => {
    if (!mine || !task.activeTimerStartedAt) return;

    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [mine, task.activeTimerStartedAt]);

  const loadLogs = useCallback(async () => {
    const response = await fetch(`/api/tasks/${task.id}/time-logs`);

    if (response.ok) {
      const payload = await response.json();
      setLogs(payload.data);
      setTotalMinutes(payload.totalLoggedMinutes);
    }
  }, [task.id]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  async function callTimer(action: "start" | "stop") {
    setError(null);
    setBusy(true);

    try {
      const response = await fetch(`/api/tasks/${task.id}/timer/${action}`, {
        method: "POST",
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setError(payload?.error ?? `Could not ${action} the timer.`);
        return;
      }

      // Starting stops whatever else was running, which the biller should be
      // told about rather than left to notice.
      if (action === "start" && payload?.stoppedPreviousTimer) {
        toast(
          `Timer started — your previous timer was stopped and ${formatMinutes(
            payload.stoppedPreviousTimer.durationMinutes,
          )} logged.`,
          "success",
        );
      } else {
        toast(action === "start" ? "Timer started" : "Timer stopped", "success");
      }

      await loadLogs();
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {mine && task.activeTimerStartedAt ? (
            <>
              <Button
                onClick={() => callTimer("stop")}
                disabled={busy}
                className="bg-red-600 hover:bg-red-700"
              >
                ⏹ Stop Timer
              </Button>
              <div>
                <p className="text-lg font-semibold tabular-nums text-red-700">
                  {elapsedLabel(task.activeTimerStartedAt, now)}
                </p>
                <p className="text-xs text-slate-500">
                  Started at {clock(task.activeTimerStartedAt)}
                </p>
              </div>
            </>
          ) : runningHere ? (
            <span className="inline-flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
              {task.activeTimerUserName ?? "Someone"} timing since{" "}
              {clock(task.activeTimerStartedAt!)}
            </span>
          ) : (
            <Button
              onClick={() => callTimer("start")}
              disabled={busy}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              ▶ Start Timer
            </Button>
          )}
        </div>

        <p className="text-sm text-slate-600">
          Total logged:{" "}
          <span className="font-semibold tabular-nums text-slate-900">
            {formatMinutes(totalMinutes)}
          </span>
        </p>
      </div>

      {error ? (
        <p className="mt-2">
          <FieldError>{error}</FieldError>
        </p>
      ) : null}

      {logs.length > 0 ? (
        <div className="mt-3 overflow-x-auto border-t border-slate-100 pt-3">
          <table className="w-full min-w-[560px] text-xs">
            <thead className="text-left text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-1">Date</th>
                <th className="py-1">Time</th>
                <th className="py-1 text-right">Duration</th>
                <th className="py-1">Logged by</th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {logs.map((log) => {
                const own = log.userId === currentUserId;
                const editable =
                  own &&
                  log.stoppedAt !== null &&
                  log.pendingEditRequestId === null &&
                  Date.now() - new Date(log.startedAt).getTime() <
                    EDIT_WINDOW_MS;

                return (
                  <tr key={log.id}>
                    <td className="py-1.5 text-slate-600">
                      {formatDateIST(log.startedAt)}
                    </td>
                    <td className="py-1.5 text-slate-600">
                      {clock(log.startedAt)} →{" "}
                      {log.stoppedAt ? clock(log.stoppedAt) : "running"}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-slate-900">
                      {formatMinutes(log.durationMinutes)}
                    </td>
                    <td className="py-1.5 text-slate-600">
                      {log.userName ?? "—"}
                    </td>
                    <td className="py-1.5 text-right">
                      <span className="inline-flex items-center gap-1.5">
                        {log.isEdited ? (
                          <Badge variant="amber">
                            Edited
                            {log.originalDurationMinutes !== null
                              ? ` from ${formatMinutes(log.originalDurationMinutes)}`
                              : ""}
                          </Badge>
                        ) : null}
                        {log.pendingEditRequestId ? (
                          <Badge variant="sky">Edit pending</Badge>
                        ) : null}
                        {editable ? (
                          <button
                            type="button"
                            onClick={() => setEditing(log)}
                            className="font-medium text-brand-700 hover:text-brand-800"
                          >
                            Request Edit
                          </button>
                        ) : null}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500">
          No time logged yet.
        </p>
      )}

      {editing ? (
        <EditRequestModal
          log={editing}
          onClose={() => setEditing(null)}
          onSubmitted={async () => {
            setEditing(null);
            await loadLogs();
          }}
        />
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function EditRequestModal({
  log,
  onClose,
  onSubmitted,
}: {
  log: TaskTimeLogDto;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const { toast } = useToast();

  const [startedAt, setStartedAt] = useState(toLocalInput(log.startedAt));
  const [stoppedAt, setStoppedAt] = useState(
    log.stoppedAt ? toLocalInput(log.stoppedAt) : "",
  );
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The biller sees the duration their correction implies before submitting.
  const newDuration =
    startedAt && stoppedAt
      ? Math.round(
          (new Date(stoppedAt).getTime() - new Date(startedAt).getTime()) /
            60_000,
        )
      : null;

  async function submit() {
    setError(null);

    if (!startedAt || !stoppedAt) return setError("Both times are required.");
    if (newDuration === null || newDuration <= 0) {
      return setError("The end time must be after the start time.");
    }
    if (reason.trim() === "") return setError("A reason is required.");

    setSaving(true);

    try {
      const response = await fetch(
        `/api/tasks/time-logs/${log.id}/edit-request`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            startedAt: new Date(startedAt).toISOString(),
            stoppedAt: new Date(stoppedAt).toISOString(),
            reason: reason.trim(),
          }),
        },
      );

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setError(payload?.error ?? "Could not submit the edit request.");
        return;
      }

      toast("Edit request submitted — awaiting PM approval", "success");
      onSubmitted();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={() => (saving ? undefined : onClose())}
      title="Request a time correction"
      description="A project manager or owner reviews this before it changes the log."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? "Submitting…" : "Submit request"}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {error ? <FieldError>{error}</FieldError> : null}

        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-inset ring-slate-200">
          Currently {clock(log.startedAt)} →{" "}
          {log.stoppedAt ? clock(log.stoppedAt) : "—"} (
          {formatMinutes(log.durationMinutes)})
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="edit-start">New start time</Label>
            <Input
              id="edit-start"
              type="datetime-local"
              value={startedAt}
              onChange={(event) => setStartedAt(event.target.value)}
              disabled={saving}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-stop">New end time</Label>
            <Input
              id="edit-stop"
              type="datetime-local"
              value={stoppedAt}
              onChange={(event) => setStoppedAt(event.target.value)}
              disabled={saving}
            />
          </div>
        </div>

        <p className="text-sm text-slate-600">
          New duration:{" "}
          <span className="font-semibold tabular-nums text-slate-900">
            {newDuration === null || newDuration <= 0
              ? "—"
              : formatMinutes(newDuration)}
          </span>
        </p>

        <div className="space-y-1.5">
          <Label htmlFor="edit-reason">Reason</Label>
          <textarea
            id="edit-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            maxLength={1000}
            disabled={saving}
            placeholder="Why the logged time is wrong"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-slate-50"
          />
        </div>
      </div>
    </Modal>
  );
}
