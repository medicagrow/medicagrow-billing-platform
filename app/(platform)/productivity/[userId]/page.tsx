import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { DateRangePicker } from "@/components/productivity/DateRangePicker";
import { StatusBadge } from "@/components/ar/StatusBadge";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/Card";
import { accessiblePracticeIds } from "@/lib/ar-access";
import { OUTCOME_LABELS } from "@/lib/ar-outcomes";
import { formatUSD } from "@/lib/format";
import { Role } from "@/lib/generated/prisma/enums";
import {
  ACTIVITY_MODULE_LABELS,
  getBillerProductivity,
  getRecentActivity,
  type ActivityModule,
  type ActivitySummary,
} from "@/lib/productivity";
import { resolveRange, toDateParam } from "@/lib/productivity/date-ranges";
import { roleBadgeVariants, roleLabels } from "@/lib/roles";
import { requireUser } from "@/lib/session";
import { formatDateTimeIST } from "@/lib/timezone";

export const metadata: Metadata = { title: "Biller Productivity" };
export const dynamic = "force-dynamic";

export default async function BillerProductivityPage({
  params,
  searchParams,
}: {
  params: { userId: string };
  searchParams: {
    preset?: string;
    from?: string;
    to?: string;
    practiceId?: string;
  };
}) {
  const user = await requireUser();

  const isManager =
    user.role === Role.OWNER || user.role === Role.PROJECT_MANAGER;

  // Anyone may view their own numbers; only managers may view others'.
  if (!isManager && user.id !== params.userId) notFound();

  const { from, to, preset } = resolveRange({
    preset: searchParams.preset,
    from: searchParams.from,
    to: searchParams.to,
  });

  const practiceIds = await accessiblePracticeIds(user);
  const practiceId =
    searchParams.practiceId &&
    (practiceIds === null || practiceIds.includes(searchParams.practiceId))
      ? searchParams.practiceId
      : undefined;

  const query = { userId: params.userId, from, to, practiceId };

  const [productivity, recentActivity] = await Promise.all([
    getBillerProductivity(query),
    getRecentActivity(query),
  ]);

  if (!productivity) notFound();

  // Group activities by module so each module gets its own panel.
  const byModule = new Map<ActivityModule, ActivitySummary[]>();

  for (const activity of productivity.activities) {
    const existing = byModule.get(activity.module) ?? [];
    existing.push(activity);
    byModule.set(activity.module, existing);
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={productivity.userName}
        description={`${
          productivity.assignedPractices.length > 0
            ? productivity.assignedPractices.join(", ")
            : "No practices assigned"
        }`}
        action={
          isManager ? (
            <Link
              href="/productivity"
              className="text-sm font-medium text-brand-700 hover:text-brand-800"
            >
              ← Back to Team Productivity
            </Link>
          ) : null
        }
      />

      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <DateRangePicker
          preset={preset}
          from={toDateParam(from)}
          to={toDateParam(to)}
        />
        <Badge variant={roleBadgeVariants[productivity.role as Role]}>
          {roleLabels[productivity.role as Role] ?? productivity.role}
        </Badge>
      </div>

      {/* --------------------------- summary cards --------------------------- */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {productivity.activities.map((activity) => (
          <Link
            key={activity.key}
            href={activity.drillDownUrl}
            className="rounded-xl border border-slate-200 bg-white p-4 shadow-card transition-colors hover:border-brand-300"
          >
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              {activity.label}
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
              {activity.count}
            </p>
            {activity.totalValue ? (
              <p className="mt-0.5 text-xs text-slate-500">
                {formatUSD(activity.totalValue)} in balance
              </p>
            ) : null}
          </Link>
        ))}
      </div>

      {/* -------------------------- module breakdown -------------------------- */}
      <div className="mb-6 space-y-3">
        {Array.from(byModule.entries()).map(([module, activities]) => (
          <details
            key={module}
            open
            className="rounded-xl border border-slate-200 bg-white shadow-card"
          >
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-900">
              {ACTIVITY_MODULE_LABELS[module]}
              <span className="ml-2 text-xs font-normal text-slate-500">
                {activities.reduce(
                  (running, activity) => running + activity.count,
                  0,
                )}{" "}
                total activities
              </span>
            </summary>
            <div className="border-t border-slate-100">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-slate-100">
                  {activities.map((activity) => (
                    <tr key={activity.key} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 text-slate-700">
                        {activity.label}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {activity.count === 0 ? (
                          <span className="tabular-nums text-slate-300">0</span>
                        ) : (
                          <Link
                            href={activity.drillDownUrl}
                            className="font-medium tabular-nums text-brand-700 hover:underline"
                          >
                            {activity.count}
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        ))}
      </div>

      {/* --------------------------- recent activity -------------------------- */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-card">
        <div className="border-b border-slate-100 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-900">
            Recent activity
            <span className="ml-2 text-xs font-normal text-slate-500">
              last {recentActivity.length} in this period
            </span>
          </h3>
        </div>

        {recentActivity.length === 0 ? (
          <div className="px-4 py-6">
            <EmptyState title="No activity logged in this period" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">When</th>
                  <th className="px-4 py-3">Record</th>
                  <th className="px-4 py-3">Practice</th>
                  <th className="px-4 py-3">Outcome</th>
                  <th className="px-4 py-3">Status set</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recentActivity.map((entry) => (
                  <tr key={entry.id} className="hover:bg-slate-50">
                    <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">
                      {formatDateTimeIST(entry.workedAt)}
                    </td>
                    <td className="px-4 py-2.5">
                      <Link
                        href={entry.recordUrl}
                        className="font-medium text-slate-900 hover:text-brand-700"
                      >
                        {entry.recordLabel}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">
                      {entry.practiceName}
                    </td>
                    <td className="px-4 py-2.5">
                      {/* Task and To Do completions carry no AR outcome. */}
                      {entry.outcomeType ? (
                        <Badge variant="neutral">
                          {OUTCOME_LABELS[entry.outcomeType]}
                        </Badge>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {entry.statusCategoryChangedTo ? (
                        <StatusBadge
                          label={entry.statusChangedTo}
                          category={entry.statusCategoryChangedTo}
                        />
                      ) : (
                        <Badge variant="neutral">{entry.statusChangedTo}</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
