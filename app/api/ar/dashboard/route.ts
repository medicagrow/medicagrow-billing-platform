import { NextResponse, type NextRequest } from "next/server";
import {
  BatchStatus,
  Role,
  StatusCategory,
} from "@/lib/generated/prisma/enums";
import { requireRole } from "@/lib/api-helpers";
import { accessiblePracticeIds } from "@/lib/ar-access";
import { insuranceAgingBreakdown } from "@/lib/ar-insurance-aging";
import { arBillerActivity, arSummary, billerProgress } from "@/lib/ar-summary";
import { AGING_BUCKETS } from "@/lib/ar-aging";
import { daysBetween, startOfTodayUtc } from "@/lib/ar-stats";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

/** GET /api/ar/dashboard — cross-practice summary for Owner / PM. */
export async function GET(request: NextRequest) {
  const session = await getSession();

  const denied = requireRole(session, [Role.OWNER, Role.PROJECT_MANAGER]);
  if (denied) return denied;

  const today = startOfTodayUtc();
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

  const [byCategory, unassigned, overdue, agingRows] = await Promise.all([
    prisma.arClaim.groupBy({
      by: ["batchId", "statusCategory"],
      where: { batchId: { in: openBatchIds } },
      _count: { _all: true },
    }),
    prisma.arClaim.groupBy({
      by: ["batchId"],
      where: { batchId: { in: openBatchIds }, assignedToId: null },
      _count: { _all: true },
    }),
    prisma.arClaim.groupBy({
      by: ["batchId"],
      where: {
        batchId: { in: openBatchIds },
        statusCategory: StatusCategory.RED,
        followUpDate: { lt: today },
      },
      _count: { _all: true },
    }),
    prisma.arClaim.findMany({
      where: { batchId: { in: openBatchIds } },
      select: { agingDays: true, balance: true },
    }),
  ]);

  const countFor = (batchId: string, category: StatusCategory) =>
    byCategory.find(
      (row) => row.batchId === batchId && row.statusCategory === category,
    )?._count._all ?? 0;

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
        needsAttention: true,
      };
    }

    const greenCount = countFor(batch.id, StatusCategory.GREEN);
    const redCount = countFor(batch.id, StatusCategory.RED);
    const blueCount = countFor(batch.id, StatusCategory.BLUE);
    const totalClaims = batch.totalClaims;
    const overdueCount =
      overdue.find((row) => row.batchId === batch.id)?._count._all ?? 0;
    const daysOpen = daysBetween(batch.uploadedAt, new Date());

    const percentGreen =
      totalClaims === 0 ? 0 : Math.round((greenCount / totalClaims) * 100);
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
      totalBalance: batch.totalBalance.toString(),
      greenCount,
      redCount,
      blueCount,
      percentGreen,
      unassignedCount:
        unassigned.find((row) => row.batchId === batch.id)?._count._all ?? 0,
      overdueCount,
      // Amber highlight: open too long, or a fifth of the batch overdue.
      needsAttention: daysOpen > 60 || percentOverdue > 20,
    };
  });

  // Biller productivity — counted from the work-note audit trail, scoped to
  // the practices in view so a PM never sees another practice's work.
  const activity = await arBillerActivity({ practiceIds, selectedPracticeId });

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

  // Aging breakdown across every open batch.
  const aging = AGING_BUCKETS.map((bucket) => {
    const matching = agingRows.filter(
      (row) => row.agingDays >= bucket.min && row.agingDays <= bucket.max,
    );

    const total = matching.reduce(
      (running, row) => running + Number(row.balance),
      0,
    );

    return {
      key: bucket.key,
      label: bucket.label,
      claimCount: matching.length,
      balance: total.toFixed(2),
    };
  });

  const totals = rows.reduce(
    (running, row) => ({
      balance: running.balance + Number(row.totalBalance),
      red: running.red + row.redCount,
      overdue: running.overdue + row.overdueCount,
      noBatch: running.noBatch + (row.batchId === null ? 1 : 0),
    }),
    { balance: 0, red: 0, overdue: 0, noBatch: 0 },
  );

  const insuranceAging = await insuranceAgingBreakdown({
    practiceIds,
    selectedPracticeId,
  });

  const [summary, progressByBiller] = await Promise.all([
    arSummary({ practiceIds, selectedPracticeId }),
    billerProgress({ practiceIds, selectedPracticeId }),
  ]);

  return NextResponse.json({
    summary: {
      totalOutstandingBalance: totals.balance.toFixed(2),
      totalRedClaims: totals.red,
      totalOverdue: totals.overdue,
      practicesWithoutBatch: totals.noBatch,
      practiceCount: rows.length,
    },
    practices: rows,
    productivity: buildProductivity(progressByBiller),
    overallProgress: {
      totalClaims: summary.totalClaims,
      totalGreenClaims: summary.totalGreenClaims,
      percentComplete: summary.percentComplete,
    },
    aging,
    insuranceAging: insuranceAging.ALL,
    insuranceAgingByCategory: insuranceAging,
  });
}
