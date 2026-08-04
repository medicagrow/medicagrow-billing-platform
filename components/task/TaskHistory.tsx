"use client";

import { useEffect, useState } from "react";
import { STATUS_LABELS, STATUS_VARIANT } from "@/components/task/TaskFormFields";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/Card";
import { formatDate } from "@/lib/format";
import type { TaskStatus } from "@/lib/generated/prisma/enums";
import { formatDateIST } from "@/lib/timezone";

interface HistoryRow {
  id: string;
  instanceNumber: number | null;
  dueDate: string | null;
  status: TaskStatus;
  completedAt: string | null;
  completedByName: string | null;
  actualMinutes: number | null;
  lastNote: string | null;
}

interface HistorySummary {
  totalInstances: number;
  totalCompletions: number;
  averageActualMinutes: number | null;
  onTimeRate: number | null;
}

/**
 * Every occurrence of a recurring series, newest first.
 *
 * Works from either end of the series — pass a parent or any instance and the
 * API resolves the rest, so the panel does not need to know which it holds.
 */
export function TaskHistory({ taskId }: { taskId: string }) {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [summary, setSummary] = useState<HistorySummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);

    fetch(`/api/tasks/${taskId}/history`)
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (cancelled || !payload) return;
        setRows(payload.rows);
        setSummary(payload.summary);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [taskId]);

  if (loading) {
    return <p className="text-sm text-slate-500">Loading history…</p>;
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        title="No occurrences yet"
        description="Instances appear here as the series generates them."
      />
    );
  }

  return (
    <div>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Due</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Completed</th>
              <th className="px-3 py-2">By</th>
              <th className="px-3 py-2 text-right">Actual</th>
              <th className="px-3 py-2">Last note</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => {
              const late =
                row.completedAt !== null &&
                row.dueDate !== null &&
                row.completedAt.slice(0, 10) > row.dueDate.slice(0, 10);

              return (
                <tr key={row.id}>
                  <td className="px-3 py-2 tabular-nums text-slate-500">
                    {row.instanceNumber ?? "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                    {row.dueDate ? formatDate(row.dueDate) : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant={STATUS_VARIANT[row.status]}>
                      {STATUS_LABELS[row.status]}
                    </Badge>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {row.completedAt ? (
                      <span className={late ? "text-amber-700" : "text-slate-600"}>
                        {formatDateIST(row.completedAt)}
                        {late ? " (late)" : ""}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-600">
                    {row.completedByName ?? (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                    {row.actualMinutes === null ? (
                      <span className="text-slate-400">—</span>
                    ) : (
                      `${row.actualMinutes}m`
                    )}
                  </td>
                  <td className="max-w-[220px] truncate px-3 py-2 text-slate-600">
                    {row.lastNote ?? <span className="text-slate-400">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {summary ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Stat
            label="Completions"
            value={`${summary.totalCompletions} of ${summary.totalInstances}`}
          />
          <Stat
            label="Average actual time"
            value={
              summary.averageActualMinutes === null
                ? "—"
                : `${summary.averageActualMinutes} min`
            }
          />
          <Stat
            label="Completed on time"
            value={
              summary.onTimeRate === null ? "—" : `${summary.onTimeRate}%`
            }
          />
        </div>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white px-3 py-2 ring-1 ring-inset ring-slate-200">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums text-slate-900">
        {value}
      </p>
    </div>
  );
}
