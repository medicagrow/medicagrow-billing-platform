"use client";

import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/Card";
import type { ActivityBreakdown } from "@/lib/productivity/types";
import { formatDateTimeIST } from "@/lib/timezone";

export interface WorkDetailRow {
  id: string;
  title: string;
  practiceName: string | null;
  assignedToName: string | null;
  taskTypeName: string | null;
  priority: string;
  actualMinutes: number | null;
  completedAt: string;
}

/**
 * Drill-down for Task and To Do completions.
 *
 * The AR table's columns (claim, insurance, denial reason) mean nothing here,
 * so completions get their own shape rather than a row of empty cells.
 */
export function WorkDetailTable({
  rows,
  breakdown,
  showTaskType,
}: {
  rows: WorkDetailRow[];
  breakdown?: ActivityBreakdown[];
  showTaskType: boolean;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="Nothing completed in this period"
        description="Completions are counted on the day the item was closed."
      />
    );
  }

  return (
    <div>
      {showTaskType && breakdown && breakdown.length > 0 ? (
        <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-card">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">
            By task type
          </p>
          <div className="flex flex-wrap gap-2">
            {breakdown.map((entry) => (
              <span
                key={entry.label}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-50 px-2.5 py-1 text-sm ring-1 ring-inset ring-slate-200"
              >
                <span className="text-slate-700">{entry.label}</span>
                <span className="font-semibold tabular-nums text-slate-900">
                  {entry.count}
                </span>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-card">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Title</th>
              {showTaskType ? <th className="px-4 py-3">Type</th> : null}
              <th className="px-4 py-3">Practice</th>
              <th className="px-4 py-3">Assigned to</th>
              <th className="px-4 py-3">Priority</th>
              {showTaskType ? (
                <th className="px-4 py-3 text-right">Actual</th>
              ) : null}
              <th className="px-4 py-3">Completed</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-900">
                  {row.title}
                </td>
                {showTaskType ? (
                  <td className="px-4 py-3">
                    {row.taskTypeName ? (
                      <Badge variant="violet">{row.taskTypeName}</Badge>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                ) : null}
                <td className="px-4 py-3 text-slate-600">
                  {row.practiceName ?? <span className="text-slate-400">—</span>}
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {row.assignedToName ?? "—"}
                </td>
                <td className="px-4 py-3 text-slate-600">{row.priority}</td>
                {showTaskType ? (
                  <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                    {row.actualMinutes === null ? (
                      <span className="text-slate-400">—</span>
                    ) : (
                      `${row.actualMinutes}m`
                    )}
                  </td>
                ) : null}
                <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                  {formatDateTimeIST(row.completedAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
