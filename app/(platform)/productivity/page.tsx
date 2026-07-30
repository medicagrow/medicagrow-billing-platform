import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { DateRangePicker } from "@/components/productivity/DateRangePicker";
import { TeamProductivityTable } from "@/components/productivity/TeamProductivityTable";
import { accessiblePracticeIds, canManageBatches } from "@/lib/ar-access";
import { AR_ACTIVITIES } from "@/lib/productivity";
import { resolveRange, toDateParam } from "@/lib/productivity/date-ranges";
import { getTeamProductivity } from "@/lib/productivity";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Productivity" };
export const dynamic = "force-dynamic";

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-card">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
        {value}
      </p>
    </div>
  );
}

export default async function TeamProductivityPage({
  searchParams,
}: {
  searchParams: {
    preset?: string;
    from?: string;
    to?: string;
    practiceId?: string;
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

  const team = await getTeamProductivity({ from, to, practiceId, practiceIds });

  const teamTotal = (key: string) =>
    team.reduce(
      (running, entry) =>
        running +
        (entry.activities.find((activity) => activity.key === key)?.count ?? 0),
      0,
    );

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Team Productivity"
        description="Work logged per team member across every module."
      />

      <div className="mb-5">
        <DateRangePicker
          preset={preset}
          from={toDateParam(from)}
          to={toDateParam(to)}
        />
      </div>

      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          label="Claims worked"
          value={String(teamTotal(AR_ACTIVITIES.CLAIMS_WORKED))}
        />
        <SummaryCard
          label="Moved to green"
          value={String(teamTotal(AR_ACTIVITIES.MOVED_TO_GREEN))}
        />
        <SummaryCard
          label="Denials worked"
          value={String(teamTotal(AR_ACTIVITIES.DENIALS_WORKED))}
        />
        <SummaryCard
          label="Escalated to office"
          value={String(teamTotal(AR_ACTIVITIES.ESCALATED_TO_OFFICE))}
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
