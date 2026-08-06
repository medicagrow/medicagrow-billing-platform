import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/Card";
import { accessiblePracticeIds, canManageBatches } from "@/lib/ar-access";
import { InsuranceAgingTable } from "@/components/ar/InsuranceAgingTable";
import { ProgressBar, progressTextClass } from "@/components/ui/ProgressBar";
import { arBillerActivity, arSummary, billerProgress } from "@/lib/ar-summary";
import { toDateParam } from "@/lib/productivity/date-ranges";
import { insuranceAgingBreakdown } from "@/lib/ar-insurance-aging";
import { agingSummary } from "@/lib/ar-aging-summary";
import { EHR_SOURCE_LABELS } from "@/lib/ehr-labels";
import { daysBetween, startOfTodayUtc } from "@/lib/ar-stats";
import { formatUSD } from "@/lib/format";
import {
  BatchStatus,
  Role,
  StatusCategory,
} from "@/lib/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "AR Dashboard" };
export const dynamic = "force-dynamic";

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const BUCKET_COLORS = [
  "bg-emerald-500",
  "bg-amber-400",
  "bg-orange-500",
  "bg-red-500",
  "bg-red-700",
];

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "red" | "amber";
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-card">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p
        className={`mt-1 text-2xl font-semibold tabular-nums ${
          tone === "red"
            ? "text-red-700"
            : tone === "amber"
              ? "text-amber-700"
              : "text-slate-900"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

export default async function ArDashboardPage({
  searchParams,
}: {
  searchParams: { practiceId?: string };
}) {
  const user = await requireUser();

  /**
   * A biller sees this page too, but as their own scorecard: every figure is
   * narrowed to the claims assigned to them. A dashboard reporting the whole
   * practice's balance to someone who works a slice of it is not information
   * they can act on.
   */
  const isBiller = !canManageBatches(user);
  const claimScope = isBiller ? { assignedToId: user.id } : {};

  const today = startOfTodayUtc();
  const practiceIds = await accessiblePracticeIds(user);

  // Global practice filter from the top bar.
  const selectedPracticeId =
    searchParams.practiceId &&
    (practiceIds === null || practiceIds.includes(searchParams.practiceId))
      ? searchParams.practiceId
      : undefined;

  const practices = await prisma.practice.findMany({
    where: {
      isActive: true,
      ...(practiceIds === null ? {} : { id: { in: practiceIds } }),
      ...(selectedPracticeId ? { id: selectedPracticeId } : {}),
    },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      ehrSource: true,
      arBatches: {
        where: { status: BatchStatus.OPEN },
        orderBy: { uploadedAt: "desc" },
        take: 1,
        select: {
          id: true,
          reportMonth: true,
          reportYear: true,
          uploadedAt: true,
          totalClaims: true,
          totalBalance: true,
        },
      },
    },
  });

  const openBatchIds = practices
    .map((practice) => practice.arBatches[0]?.id)
    .filter((id): id is string => Boolean(id));

  /**
   * One wave, not four. Everything here needs only `openBatchIds`, which the
   * practice query above already produced; awaiting them in sequence spent
   * three round trips waiting where one would do.
   */
  const [
    byCategory,
    overdueGroups,
    aging,
    ownTotals,
    productivity,
    insuranceAging,
    summary,
    progressByBiller,
  ] = await Promise.all([
    prisma.arClaim.groupBy({
      by: ["batchId", "statusCategory"],
      where: { batchId: { in: openBatchIds }, ...claimScope },
      _count: { _all: true },
    }),
    prisma.arClaim.groupBy({
      by: ["batchId"],
      where: {
        batchId: { in: openBatchIds },
        statusCategory: StatusCategory.RED,
        followUpDate: { lt: today },
        ...claimScope,
      },
      _count: { _all: true },
    }),
    // Bucketed by Postgres — this used to fetch every claim in every open
    // batch and filter the array five times.
    agingSummary({ batchIds: openBatchIds, ...claimScope }),
    // A biller's batch totals are their own claims, not the batch's — the
    // batch columns count work that was never theirs.
    isBiller
      ? prisma.arClaim.groupBy({
          by: ["batchId"],
          where: { batchId: { in: openBatchIds }, ...claimScope },
          _count: { _all: true },
          _sum: { balance: true },
        })
      : Promise.resolve([]),
    // Same helper the API route uses, so the page and /api/ar/dashboard
    // cannot disagree — and both are scoped to this user's practices.
    isBiller
      ? Promise.resolve([])
      : arBillerActivity({ practiceIds, selectedPracticeId }),
    insuranceAgingBreakdown({
      practiceIds,
      selectedPracticeId,
      ...(isBiller ? { assignedToId: user.id } : {}),
    }),
    arSummary({
      practiceIds,
      selectedPracticeId,
      ...(isBiller ? { assignedToId: user.id } : {}),
    }),
    billerProgress({ practiceIds, selectedPracticeId }),
  ]);

  const ownTotalFor = (batchId: string) =>
    ownTotals.find((row) => row.batchId === batchId);

  const countFor = (batchId: string, category: StatusCategory) =>
    byCategory.find(
      (row) => row.batchId === batchId && row.statusCategory === category,
    )?._count._all ?? 0;

  const rows = practices.map((practice) => {
    const batch = practice.arBatches[0];

    if (!batch) {
      return {
        practice,
        batch: null,
        greenCount: 0,
        redCount: 0,
        blueCount: 0,
        overdueCount: 0,
        percentGreen: 0,
        daysOpen: 0,
        needsAttention: true,
      };
    }

    const greenCount = countFor(batch.id, StatusCategory.GREEN);
    const overdueCount =
      overdueGroups.find((row) => row.batchId === batch.id)?._count._all ?? 0;
    const daysOpen = daysBetween(batch.uploadedAt, new Date());

    const own = ownTotalFor(batch.id);
    const totalClaims = isBiller ? (own?._count._all ?? 0) : batch.totalClaims;
    const totalBalance = isBiller
      ? (own?._sum.balance?.toString() ?? "0.00")
      : batch.totalBalance.toString();

    const percentOverdue =
      totalClaims === 0 ? 0 : (overdueCount / totalClaims) * 100;

    return {
      practice,
      batch: { ...batch, totalClaims, totalBalance },
      greenCount,
      redCount: countFor(batch.id, StatusCategory.RED),
      blueCount: countFor(batch.id, StatusCategory.BLUE),
      overdueCount,
      percentGreen:
        totalClaims === 0 ? 0 : Math.round((greenCount / totalClaims) * 100),
      daysOpen,
      needsAttention: daysOpen > 60 || percentOverdue > 20,
    };
  })
  // A biller's cross-practice table lists the practices they actually hold
  // claims in, not every practice with an open batch.
  .filter((row) => !isBiller || (row.batch?.totalClaims ?? 0) > 0);

  const totals = rows.reduce(
    (running, row) => ({
      balance: running.balance + Number(row.batch?.totalBalance ?? 0),
      red: running.red + row.redCount,
      overdue: running.overdue + row.overdueCount,
      noBatch: running.noBatch + (row.batch ? 0 : 1),
    }),
    { balance: 0, red: 0, overdue: 0, noBatch: 0 },
  );

  const startOfMonth = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1),
  );

  const rankedProductivity = [...productivity].sort(
    (a, b) => b.thisMonth - a.thisMonth,
  );

  const productivityFrom = toDateParam(startOfMonth);
  const productivityTo = toDateParam(today);

  const agingTotal = aging.reduce(
    (sum, bucket) => sum + Number(bucket.balance),
    0,
  );

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="AR Dashboard"
        description={
          isBiller
            ? "Your claims, across every practice you work."
            : "Every practice, in one view."
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          label={isBiller ? "My outstanding balance" : "Total outstanding"}
          value={formatUSD(totals.balance.toFixed(2))}
        />
        <SummaryCard
          label={isBiller ? "My red claims" : "Red claims"}
          value={String(totals.red)}
        />
        <SummaryCard
          label={isBiller ? "My overdue follow-ups" : "Overdue follow-ups"}
          value={String(totals.overdue)}
          tone={totals.overdue > 0 ? "red" : undefined}
        />
        {isBiller ? (
          <SummaryCard label="My claims" value={String(summary.totalClaims)} />
        ) : (
          <SummaryCard
            label="No active batch"
            value={String(totals.noBatch)}
            tone={totals.noBatch > 0 ? "amber" : undefined}
          />
        )}
      </div>

      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-card">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-900">
            Overall AR Follow-Up Progress
          </h3>
          <p className="text-sm tabular-nums text-slate-600">
            <span
              className={`font-semibold ${progressTextClass(summary.percentComplete)}`}
            >
              {summary.totalGreenClaims}
            </span>{" "}
            claims completed of {summary.totalClaims} total (
            {summary.percentComplete}%)
          </p>
        </div>
        <ProgressBar percent={summary.percentComplete} size="lg" />
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No practices assigned to you yet" />
      ) : (
        <div className="mb-6 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-card">
          <table className="w-full min-w-[1040px] text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Practice</th>
                <th className="px-4 py-3">EHR</th>
                <th className="px-4 py-3">Batch</th>
                <th className="px-4 py-3 text-right">Days open</th>
                <th className="px-4 py-3 text-right">Claims</th>
                <th className="px-4 py-3 text-right">Balance</th>
                <th className="px-4 py-3 text-right">Green</th>
                <th className="px-4 py-3 text-right">Red</th>
                <th className="px-4 py-3 text-right">Blue</th>
                <th className="px-4 py-3 text-right">Overdue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr
                  key={row.practice.id}
                  className={
                    row.needsAttention && row.batch
                      ? "bg-amber-50/60 hover:bg-amber-50"
                      : "hover:bg-slate-50"
                  }
                >
                  <td className="px-4 py-3">
                    <Link
                      href={
                        row.batch
                          ? `/ar/batches/${row.batch.id}`
                          : `/ar/practices/${row.practice.id}`
                      }
                      className="font-medium text-slate-900 hover:text-brand-700"
                    >
                      {row.practice.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {EHR_SOURCE_LABELS[row.practice.ehrSource]}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {row.batch ? (
                      `${MONTH_NAMES[row.batch.reportMonth - 1]} ${row.batch.reportYear}`
                    ) : (
                      <Badge variant="amber">No active batch</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {row.batch ? (
                      <span
                        className={
                          row.daysOpen > 60
                            ? "font-medium text-amber-700"
                            : "text-slate-700"
                        }
                      >
                        {row.daysOpen}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                    {row.batch?.totalClaims ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-900">
                    {row.batch
                      ? formatUSD(row.batch.totalBalance.toString())
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-emerald-700">
                    {row.batch ? `${row.percentGreen}%` : "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-red-700">
                    {row.batch ? (
                      <Link
                        href={`/ar/batches/${row.batch.id}?statusCategory=RED`}
                        className="underline-offset-4 hover:underline"
                      >
                        {row.redCount}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-sky-700">
                    {row.batch ? (
                      <Link
                        href={`/ar/batches/${row.batch.id}?statusCategory=BLUE`}
                        className="underline-offset-4 hover:underline"
                      >
                        {row.blueCount}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {row.batch ? (
                      <Link
                        href={`/ar/batches/${row.batch.id}?overdue=true`}
                        className={`underline-offset-4 hover:underline ${
                          row.overdueCount > 0
                            ? "font-medium text-red-700"
                            : "text-slate-600"
                        }`}
                      >
                        {row.overdueCount}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Aging breakdown */}
      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-card">
        <h3 className="text-sm font-semibold text-slate-900">
          Aging breakdown
          <span className="ml-2 text-xs font-normal text-slate-500">
            balance across all open batches
          </span>
        </h3>

        {agingTotal === 0 ? (
          <p className="mt-3 text-sm text-slate-500">
            No claims in any open batch yet.
          </p>
        ) : (
          <>
            <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-slate-100">
              {aging.map((bucket, index) => (
                <div
                  key={bucket.key}
                  className={BUCKET_COLORS[index]}
                  style={{
                    width: `${(Number(bucket.balance) / agingTotal) * 100}%`,
                  }}
                  title={`${bucket.label}: ${formatUSD(bucket.balance)}`}
                />
              ))}
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {aging.map((bucket, index) => (
                <div key={bucket.key} className="flex items-start gap-2">
                  <span
                    className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-sm ${BUCKET_COLORS[index]}`}
                  />
                  <div>
                    <p className="text-xs text-slate-500">{bucket.label}</p>
                    <p className="text-sm font-semibold tabular-nums text-slate-900">
                      {formatUSD(bucket.balance)}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      {bucket.claimCount} claim
                      {bucket.claimCount === 1 ? "" : "s"}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="mb-6">
        <InsuranceAgingTable data={insuranceAging} />
      </div>

      {/* Biller productivity — a biller has no team, so it is not shown. */}
      {isBiller ? null : (
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card">
        <div className="border-b border-slate-100 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-900">
            Biller productivity
            <span className="ml-2 text-xs font-normal text-slate-500">
              notes logged
            </span>
          </h3>
        </div>

        {rankedProductivity.length === 0 ? (
          <div className="px-4 py-6">
            <EmptyState title="No billers yet" />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3 text-right">Today</th>
                <th className="px-4 py-3 text-right">This week</th>
                <th className="px-4 py-3 text-right">This month</th>
                <th className="px-4 py-3">Claim progress</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rankedProductivity.map((entry) => (
                <tr key={entry.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/productivity/${entry.id}?from=${productivityFrom}&to=${productivityTo}${selectedPracticeId ? `&practiceId=${selectedPracticeId}` : ""}`}
                      className="font-medium text-slate-900 hover:text-brand-700"
                    >
                      {entry.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {entry.role === Role.BILLER ? "Biller" : "Project Manager"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                    {entry.today}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                    {entry.thisWeek}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-900">
                    {entry.thisMonth}
                  </td>
                  <td className="px-4 py-3">
                    {(() => {
                      const progress = progressByBiller.get(entry.id);

                      if (!progress || progress.assignedClaims === 0) {
                        return (
                          <span className="text-xs text-slate-400">
                            No claims assigned
                          </span>
                        );
                      }

                      return (
                        <div className="flex items-center gap-2">
                          <ProgressBar
                            percent={progress.percentComplete}
                            className="w-24"
                          />
                          <span className="whitespace-nowrap text-xs tabular-nums text-slate-600">
                            <span
                              className={`font-medium ${progressTextClass(progress.percentComplete)}`}
                            >
                              {progress.percentComplete}%
                            </span>{" "}
                            ({progress.completedClaims} of{" "}
                            {progress.assignedClaims} claims)
                          </span>
                        </div>
                      );
                    })()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      )}
    </div>
  );
}
