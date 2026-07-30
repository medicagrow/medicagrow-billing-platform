"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/Card";
import { ProgressBar, progressTextClass } from "@/components/ui/ProgressBar";
import { downloadCsv } from "@/lib/csv-export";
import { roleBadgeVariants, roleLabels } from "@/lib/roles";
import type { Role } from "@/lib/generated/prisma/enums";
import type { BillerProductivity } from "@/lib/productivity/types";

/** Column order is taken from the first row, so new modules appear for free. */
export function TeamProductivityTable({
  team,
  from,
  to,
  practiceId,
}: {
  team: BillerProductivity[];
  from: string;
  to: string;
  practiceId?: string;
}) {
  if (team.length === 0) {
    return (
      <EmptyState
        title="No team members to report on"
        description="Billers and project managers appear here once they are assigned to a practice."
      />
    );
  }

  const activityColumns = team[0]!.activities.map((activity) => ({
    key: activity.key,
    label: activity.label,
  }));

  const totalFor = (entry: BillerProductivity) =>
    entry.activities.reduce((running, activity) => running + activity.count, 0);

  const countOf = (entry: BillerProductivity, key: string) =>
    entry.activities.find((activity) => activity.key === key)?.count ?? 0;

  // Completion rate = claims moved to green / claims worked, in this window.
  const completionOf = (entry: BillerProductivity) => {
    const worked = countOf(entry, "ar_claims_worked");
    const green = countOf(entry, "ar_moved_to_green");
    return worked === 0 ? 0 : Math.round((green / worked) * 100);
  };

  const detailHref = (userId: string) => {
    const params = new URLSearchParams({ from, to });
    if (practiceId) params.set("practiceId", practiceId);
    return `/productivity/${userId}?${params.toString()}`;
  };

  function handleExport() {
    downloadCsv(
      `team-productivity-${from}-to-${to}.csv`,
      [
        "Name",
        "Role",
        "Practices",
        ...activityColumns.map((column) => column.label),
        "Total Activity",
        "Completion %",
      ],
      team.map((entry) => [
        entry.userName,
        roleLabels[entry.role as Role] ?? entry.role,
        entry.assignedPractices.join("; "),
        ...activityColumns.map((column) => countOf(entry, column.key)),
        totalFor(entry),
        completionOf(entry),
      ]),
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-card">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-900">
          By team member
          <span className="ml-2 text-xs font-normal text-slate-500">
            {from} → {to}
          </span>
        </h3>
        <Button
          variant="secondary"
          className="px-3 py-2 text-xs"
          onClick={handleExport}
        >
          Export CSV
        </Button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1100px] text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Practices</th>
              {activityColumns.map((column) => (
                <th key={column.key} className="px-4 py-3 text-right">
                  {column.label}
                </th>
              ))}
              <th className="px-4 py-3 text-right">Total</th>
              <th className="px-4 py-3">Completion</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {team.map((entry) => {
              const total = totalFor(entry);
              const completion = completionOf(entry);

              return (
                <tr key={entry.userId} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link
                      href={detailHref(entry.userId)}
                      className="font-medium text-slate-900 hover:text-brand-700"
                    >
                      {entry.userName}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      variant={roleBadgeVariants[entry.role as Role] ?? "neutral"}
                    >
                      {roleLabels[entry.role as Role] ?? entry.role}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {entry.assignedPractices.length === 0 ? (
                      <span className="text-slate-400">None</span>
                    ) : (
                      entry.assignedPractices.join(", ")
                    )}
                  </td>

                  {entry.activities.map((activity) => (
                    <td
                      key={activity.key}
                      className="px-4 py-3 text-right tabular-nums"
                    >
                      {activity.count === 0 ? (
                        <span className="text-slate-300">0</span>
                      ) : (
                        <Link
                          href={activity.drillDownUrl}
                          className="font-medium text-brand-700 hover:text-brand-800 hover:underline"
                        >
                          {activity.count}
                        </Link>
                      )}
                    </td>
                  ))}

                  <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-900">
                    {total}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <ProgressBar percent={completion} className="w-20" />
                      <span
                        className={`w-9 text-right text-xs tabular-nums ${progressTextClass(completion)}`}
                      >
                        {completion}%
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
