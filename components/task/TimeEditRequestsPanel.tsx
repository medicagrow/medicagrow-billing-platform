"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/Card";
import { FieldError, Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/toast";
import { formatMinutes } from "@/lib/task-timer-serialize";
import { formatDateIST, formatDateTimeIST, formatTimeIST } from "@/lib/timezone";

interface EditRequestRow {
  id: string;
  reason: string;
  createdAt: string;
  requestedByName: string;
  taskId: string;
  taskLabel: string;
  original: {
    logId: string;
    startedAt: string;
    stoppedAt: string | null;
    durationMinutes: number | null;
  };
  requested: {
    startedAt: string;
    stoppedAt: string;
    durationMinutes: number;
  };
}

const clock = (iso: string) => formatTimeIST(iso);

const range = (from: string, to: string | null) =>
  `${clock(from)} → ${to ? clock(to) : "—"}`;

/**
 * The PM/Owner review queue for time corrections.
 *
 * Approving can still fail: the corrected range is checked against that
 * biller's other logs for the day, and a clash comes back as a conflict
 * message naming the task it collides with. That is shown inline on the row
 * rather than as a toast, since it needs reading.
 */
export function TimeEditRequestsPanel() {
  const { toast } = useToast();

  const [requests, setRequests] = useState<EditRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);

    try {
      const response = await fetch("/api/tasks/time-logs/edit-requests");
      if (response.ok) {
        const payload = await response.json();
        setRequests(payload.data);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function review(id: string, status: "APPROVED" | "REJECTED") {
    setError(null);
    setConflicts((current) => ({ ...current, [id]: "" }));

    const reviewNote = (notes[id] ?? "").trim();

    // A rejection without a reason leaves the biller nothing to act on.
    if (status === "REJECTED" && reviewNote === "") {
      setError("A review note is required when rejecting.");
      return;
    }

    setBusyId(id);

    try {
      const response = await fetch(
        `/api/tasks/time-logs/edit-requests/${id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status,
            reviewNote: reviewNote || undefined,
          }),
        },
      );

      const payload = await response.json().catch(() => null);

      if (response.status === 409 && payload?.conflict) {
        setConflicts((current) => ({ ...current, [id]: payload.error }));
        return;
      }

      if (!response.ok) {
        setError(payload?.error ?? "Could not review the request.");
        return;
      }

      toast(
        status === "APPROVED" ? "Edit approved" : "Edit rejected",
        "success",
      );
      await load();
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return <p className="text-sm text-slate-500">Loading edit requests…</p>;
  }

  if (requests.length === 0) {
    return (
      <EmptyState
        title="No pending time edit requests"
        description="Corrections a biller submits appear here for review."
      />
    );
  }

  return (
    <div>
      {error ? (
        <p className="mb-3">
          <FieldError>{error}</FieldError>
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-card">
        <table className="w-full min-w-[980px] text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Task</th>
              <th className="px-4 py-3">Biller</th>
              <th className="px-4 py-3">Original</th>
              <th className="px-4 py-3">Requested</th>
              <th className="px-4 py-3">Reason</th>
              <th className="px-4 py-3">Submitted</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {requests.map((request) => (
              <tr key={request.id} className="align-top">
                <td className="px-4 py-3 font-medium text-slate-900">
                  {request.taskLabel}
                  {conflicts[request.id] ? (
                    <p className="mt-1 rounded-md bg-red-50 px-2 py-1 text-xs font-normal text-red-800 ring-1 ring-inset ring-red-200">
                      {conflicts[request.id]}
                    </p>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {request.requestedByName}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                  {range(request.original.startedAt, request.original.stoppedAt)}
                  <span className="block text-xs text-slate-400">
                    {formatMinutes(request.original.durationMinutes)}
                  </span>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-900">
                  {range(
                    request.requested.startedAt,
                    request.requested.stoppedAt,
                  )}
                  <span className="block text-xs text-slate-500">
                    {formatMinutes(request.requested.durationMinutes)}
                  </span>
                </td>
                <td className="max-w-[220px] px-4 py-3 text-slate-600">
                  {request.reason}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-500">
                  {formatDateIST(request.createdAt)}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-col gap-2">
                    <Input
                      value={notes[request.id] ?? ""}
                      onChange={(event) =>
                        setNotes((current) => ({
                          ...current,
                          [request.id]: event.target.value,
                        }))
                      }
                      placeholder="Review note"
                      className="min-w-[160px] text-xs"
                      aria-label={`Review note for ${request.taskLabel}`}
                    />
                    <div className="flex gap-2">
                      <Button
                        className="px-2.5 py-1 text-xs"
                        onClick={() => review(request.id, "APPROVED")}
                        disabled={busyId === request.id}
                      >
                        Approve
                      </Button>
                      <Button
                        variant="secondary"
                        className="px-2.5 py-1 text-xs"
                        onClick={() => review(request.id, "REJECTED")}
                        disabled={busyId === request.id}
                      >
                        Reject
                      </Button>
                    </div>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-xs text-slate-500">
        <Badge variant="sky">Pending only</Badge> Approved and rejected
        requests leave this queue.
      </p>

      <DirectEditsSection />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

interface DirectEditRow {
  logId: string;
  taskId: string;
  taskLabel: string;
  practiceName: string | null;
  billerName: string;
  startedAt: string;
  stoppedAt: string | null;
  durationMinutes: number | null;
  originalDurationMinutes: number | null;
  editNote: string | null;
  editedByName: string | null;
  editedAt: string | null;
}

/**
 * Corrections a manager applied without an approval step.
 *
 * Read-only, and deliberately sitting under the queue rather than somewhere
 * else: a direct edit carries no second signature, so this record is the only
 * check on it, and it belongs where the people who can make one will see it.
 */
function DirectEditsSection() {
  const [rows, setRows] = useState<DirectEditRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;

    (async () => {
      try {
        const response = await fetch("/api/tasks/time-logs/direct-edits");
        if (response.ok && live) {
          const payload = await response.json();
          setRows(payload.data);
        }
      } finally {
        if (live) setLoading(false);
      }
    })();

    return () => {
      live = false;
    };
  }, []);

  if (loading) return null;

  return (
    <div className="mt-6 border-t border-slate-200 pt-4">
      <h4 className="text-sm font-semibold text-slate-900">Direct edits</h4>
      <p className="mt-0.5 text-xs text-slate-500">
        Time corrections a manager applied without an approval step, over the
        last 30 days.
      </p>

      {rows.length === 0 ? (
        <p className="mt-3 text-xs text-slate-500">
          No direct edits in this period.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full min-w-[840px] text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Task</th>
                <th className="px-3 py-2">Biller</th>
                <th className="px-3 py-2">Original</th>
                <th className="px-3 py-2">New</th>
                <th className="px-3 py-2">Edit note</th>
                <th className="px-3 py-2">Edited by</th>
                <th className="px-3 py-2">Edited at</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr key={row.logId}>
                  <td className="px-3 py-2 text-slate-800">
                    {row.taskLabel}
                    {row.practiceName ? (
                      <span className="block text-slate-400">
                        {row.practiceName}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-slate-700">{row.billerName}</td>
                  <td className="px-3 py-2 tabular-nums text-slate-500">
                    {/*
                      Only the duration survives a correction — the times the
                      timer originally recorded are overwritten by design.
                    */}
                    {row.originalDurationMinutes === null
                      ? "—"
                      : formatMinutes(row.originalDurationMinutes)}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-slate-900">
                    {range(row.startedAt, row.stoppedAt)}
                    <span className="block text-slate-500">
                      {formatMinutes(row.durationMinutes)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-600">
                    {row.editNote ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-slate-700">
                    {row.editedByName ?? "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-500">
                    {row.editedAt ? formatDateTimeIST(row.editedAt) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
