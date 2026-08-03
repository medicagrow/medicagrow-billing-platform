import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { ProductivityFilterBar } from "@/components/productivity/ProductivityFilterBar";
import { TeamProductivityTable } from "@/components/productivity/TeamProductivityTable";
import { accessiblePracticeIds, canManageBatches } from "@/lib/ar-access";
import { Role } from "@/lib/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { AR_ACTIVITIES, WORK_ACTIVITIES } from "@/lib/productivity";
import { resolveRange, toDateParam } from "@/lib/productivity/date-ranges";
import { getTeamProductivity } from "@/lib/productivity";
import { requireUser } from "@/lib/session";
import { formatMinutes } from "@/lib/task-timer-serialize";
import { getTimeLogSummary } from "@/lib/time-analysis";

export const metadata: Metadata = { title: "Productivity" };
export const dynamic = "force-dynamic";

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
        className={`mt-1 text-2xl font-semibold tabular-nums ${tone ?? "text-slate-900"}`}
      >
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

/** Lower is better: under the estimate is green, well over it is red. */
function efficiencyTone(rate: number | null): string {
  if (rate === null) return "text-slate-400";
  if (rate < 100) return "text-emerald-600";
  if (rate <= 120) return "text-amber-600";
  return "text-red-600";
}

const list = (value?: string) =>
  (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");

export default async function TeamProductivityPage({
  searchParams,
}: {
  searchParams: {
    preset?: string;
    from?: string;
    to?: string;
    practiceId?: string;
    practiceIds?: string;
    userIds?: string;
  };
}) {
  const user = await requireUser();

  if (!canManageBatches(user)) notFound();

  const { from, to, preset } = resolveRange({
    preset: searchParams.preset,
    from: searchParams.from,
    to: searchParams.to,
  });

  const practiceIds = await accessiblePracticeIds(user);

  // Honour the global practice selector, ignoring an out-of-scope id.
  const practiceId =
    searchParams.practiceId &&
    (practiceIds === null || practiceIds.includes(searchParams.practiceId))
      ? searchParams.practiceId
      : undefined;

  // The report's own filters, narrowed the same way — a hand-edited query
  // string cannot widen a PM's scope.
  const selectedPracticeIds = list(searchParams.practiceIds).filter(
    (id) => practiceIds === null || practiceIds.includes(id),
  );

  const selectedBillerIds = list(searchParams.userIds);

  const [billers, practices] = await Promise.all([
    prisma.user.findMany({
      where: {
        isActive: true,
        role: { in: [Role.BILLER, Role.PROJECT_MANAGER] },
        ...(practiceIds === null
          ? {}
          : { practices: { some: { practiceId: { in: practiceIds } } } }),
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.practice.findMany({
      where: {
        isActive: true,
        ...(practiceIds === null ? {} : { id: { in: practiceIds } }),
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  /**
   * Efficiency comes from the Time Log module rather than being worked out
   * again here, so this card and /productivity/time-logs cannot report
   * different rates for the same filters.
   */
  const [team, timeSummary] = await Promise.all([
    getTeamProductivity({
      from,
      to,
      practiceId,
      selectedPracticeIds,
      practiceIds,
      userIds: selectedBillerIds,
    }),
    getTimeLogSummary({
      from,
      to,
      userIds: selectedBillerIds.length > 0 ? selectedBillerIds : undefined,
      practiceIds: practiceId
        ? [practiceId]
        : selectedPracticeIds.length > 0
          ? selectedPracticeIds
          : (practiceIds ?? undefined),
    }),
  ]);

  const teamTotal = (key: string) =>
    team.reduce(
      (running, entry) =>
        running +
        (entry.activities.find((activity) => activity.key === key)?.count ?? 0),
      0,
    );

  const loggedMinutes = team.reduce(
    (running, entry) => running + entry.totalLoggedMinutes,
    0,
  );

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Team Productivity"
        description="Work logged per team member across every module."
      />

      <div className="mb-5">
        <ProductivityFilterBar
          preset={preset}
          from={toDateParam(from)}
          to={toDateParam(to)}
          billers={billers}
          practices={practices}
          selectedBillerIds={selectedBillerIds}
          selectedPracticeIds={selectedPracticeIds}
        />
      </div>

      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          label="Total claims worked"
          value={String(teamTotal(AR_ACTIVITIES.CLAIMS_WORKED))}
        />
        <SummaryCard
          label="Total hours logged"
          value={formatMinutes(loggedMinutes)}
        />
        <SummaryCard
          label="Tasks completed"
          value={String(teamTotal(WORK_ACTIVITIES.TASKS_COMPLETED))}
        />
        <SummaryCard
          label="Overall efficiency"
          value={
            timeSummary.efficiencyRate === null
              ? "—"
              : `${timeSummary.efficiencyRate.toFixed(1)}%`
          }
          tone={efficiencyTone(timeSummary.efficiencyRate)}
          hint="Logged ÷ estimated"
        />
      </div>

      <TeamProductivityTable
        team={team}
        from={toDateParam(from)}
        to={toDateParam(to)}
        practiceId={practiceId}
      />
    </div>
  );
}
