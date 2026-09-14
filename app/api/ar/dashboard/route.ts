import { NextResponse, type NextRequest } from "next/server";
import { BatchStatus, Role } from "@/lib/generated/prisma/enums";
import { requireAuth } from "@/lib/api-helpers";
import { accessiblePracticeIds } from "@/lib/ar-access";
import { insuranceAgingBreakdown } from "@/lib/ar-insurance-aging";
import { arBillerActivity, arSummary, billerProgress } from "@/lib/ar-summary";
import { agingSummary } from "@/lib/ar-aging-summary";
import { batchStatsFor, daysBetween } from "@/lib/ar-stats";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

/**
 * GET /api/ar/dashboard — cross-practice summary.
 *
 * Owners and PMs see the practices they can reach; a biller sees the same
 * shape narrowed to the claims assigned to them, which is their scorecard
 * rather than the practice's.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();

  const denied = requireAuth(session);
  if (denied) return denied;

  const isBiller = session!.user.role === Role.BILLER;
  const claimScope = isBiller ? { assignedToId: session!.user.id } : {};

  const practiceIds = await accessiblePracticeIds(session!.user);
  const practiceScope = practiceIds === null ? {} : { id: { in: practiceIds } };

  // Global practice filter, ignored when it names a practice out of scope.
  const requestedPracticeId =
    request.nextUrl.searchParams.get("practiceId") ?? undefined;
  const selectedPracticeId =
    requestedPracticeId &&
    (practiceIds === null || practiceIds.includes(requestedPracticeId))
      ? requestedPracticeId
      : undefined;

  const practices = await prisma.practice.findMany({
    where: {
      isActive: true,
      ...practiceScope,
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
          targetCompletionDate: true,
        },
      },
    },
  });

  const openBatchIds = practices
    .map((practice) => practice.arBatches[0]?.id)
    .filter((id): id is string => Boolean(id));

  /**
   * One wave, not five.
   *
   * Everything below needs only `openBatchIds`, which the practice query
   * above already produced. Awaiting them in sequence — as this route used to
   * — spent four round trips waiting where one would do, and every one of
   * those is a trip to Mumbai.
   */
  const [
    statsByBatch,
    aging,
    activity,
    insuranceAging,
    summary,
    progressByBiller,
  ] = await Promise.all([
      /**
       * Every per-practice count — red, blue, green, total, balance, overdue,
       * unassigned — over actionable claims, from the helper the page and the
       * practices list share. A biller's figures are their own claims.
       */
      batchStatsFor(openBatchIds, claimScope),
      // Bucketed by Postgres — this used to fetch every claim and filter
      // the array five times.
      agingSummary({ batchIds: openBatchIds, ...claimScope }),
      // The panel is about managing a team; a biller has none.
      isBiller
        ? Promise.resolve([])
        : arBillerActivity({ practiceIds, selectedPracticeId }),
      insuranceAgingBreakdown({
        practiceIds,
        selectedPracticeId,
        ...claimScope,
      }),
      arSummary({ practiceIds, selectedPracticeId, ...claimScope }),
      billerProgress({ practiceIds, selectedPracticeId }),
    ]);

  const rows = practices.map((practice) => {
    const batch = practice.arBatches[0];

    if (!batch) {
      return {
        practiceId: practice.id,
        practiceName: practice.name,
        ehrSource: practice.ehrSource,
        batchId: null,
        reportMonth: null,
        reportYear: null,
        daysOpen: null,
        totalClaims: 0,
        totalBalance: "0.00",
        greenCount: 0,
        redCount: 0,
        blueCount: 0,
        percentGreen: 0,
        unassignedCount: 0,
        overdueCount: 0,
        notActionableCount: 0,
        needsAttention: true,
      };
    }

    const stats = statsByBatch.get(batch.id);

    const totalClaims = stats?.totalClaims ?? 0;
    const overdueCount = stats?.overdueCount ?? 0;
    const daysOpen = daysBetween(batch.uploadedAt, new Date());

    const percentOverdue =
      totalClaims === 0 ? 0 : (overdueCount / totalClaims) * 100;

    return {
      practiceId: practice.id,
      practiceName: practice.name,
      ehrSource: practice.ehrSource,
      batchId: batch.id,
      reportMonth: batch.reportMonth,
      reportYear: batch.reportYear,
      daysOpen,
      totalClaims,
      totalBalance: stats?.totalBalance ?? "0.00",
      greenCount: stats?.greenCount ?? 0,
      redCount: stats?.redCount ?? 0,
      blueCount: stats?.blueCount ?? 0,
      percentGreen: stats?.percentComplete ?? 0,
      unassignedCount: stats?.unassignedCount ?? 0,
      overdueCount,
      /** Left out of every figure above; returned so it can be shown. */
      notActionableCount: stats?.notActionableCount ?? 0,
      // Amber highlight: open too long, or a fifth of the batch overdue.
      needsAttention: daysOpen > 60 || percentOverdue > 20,
    };
  });

  /**
   * A biller's table lists the practices they hold claims in — fresh ones
   * included. Filtering on the actionable total alone would hide a practice
   * from someone whose only claims there are not due yet.
   */
  const visibleRows = isBiller
    ? rows.filter((row) => row.totalClaims + row.notActionableCount > 0)
    : rows;

  const buildProductivity = (
    progress: Awaited<ReturnType<typeof billerProgress>>,
  ) =>
    activity
      .map((user) => {
        const claims = progress.get(user.id);

        return {
          userId: user.id,
          name: user.name,
          role: user.role,
          today: user.today,
          thisWeek: user.thisWeek,
          thisMonth: user.thisMonth,
          assignedClaims: claims?.assignedClaims ?? 0,
          completedClaims: claims?.completedClaims ?? 0,
          percentComplete: claims?.percentComplete ?? 0,
        };
      })
      .sort((a, b) => b.thisMonth - a.thisMonth);

  // A biller totals only the practices they hold claims in.
  const totals = visibleRows.reduce(
    (running, row) => ({
      balance: running.balance + Number(row.totalBalance),
      red: running.red + row.redCount,
      overdue: running.overdue + row.overdueCount,
      noBatch: running.noBatch + (row.batchId === null ? 1 : 0),
    }),
    { balance: 0, red: 0, overdue: 0, noBatch: 0 },
  );

  return NextResponse.json({
    summary: {
      totalOutstandingBalance: totals.balance.toFixed(2),
      totalRedClaims: totals.red,
      totalOverdue: totals.overdue,
      practicesWithoutBatch: totals.noBatch,
      practiceCount: visibleRows.length,
    },
    practices: visibleRows,
    productivity: buildProductivity(progressByBiller),
    overallProgress: {
      totalClaims: summary.totalClaims,
      totalGreenClaims: summary.totalGreenClaims,
      percentComplete: summary.percentComplete,
      // What the three figures above exclude, for the subtitle.
      notActionableClaims: summary.notActionableClaims,
    },
    aging,
    insuranceAging: insuranceAging.ALL,
    insuranceAgingByCategory: insuranceAging,
  });
}
