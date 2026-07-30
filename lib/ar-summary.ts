import { BatchStatus, StatusCategory } from "@/lib/generated/prisma/enums";
import { daysBetween, startOfTodayUtc } from "@/lib/ar-stats";
import { centsToDecimalString, toCents } from "@/lib/money";
import { prisma } from "@/lib/prisma";

/**
 * Cross-practice AR roll-up shared by the platform homepage and the AR
 * dashboard, so the two can never disagree about the same numbers.
 */

export interface PracticeSummaryRow {
  practiceId: string;
  practiceName: string;
  batchId: string;
  reportMonth: number;
  reportYear: number;
  totalClaims: number;
  greenCount: number;
  percentComplete: number;
  daysOpen: number;
}

export interface ArSummary {
  openBatchCount: number;
  totalBalance: string;
  totalClaims: number;
  totalGreenClaims: number;
  totalRedClaims: number;
  overdueCount: number;
  percentComplete: number;
  practices: PracticeSummaryRow[];
}

export async function arSummary({
  practiceIds,
  selectedPracticeId,
}: {
  /** null means "every practice" (Owner). */
  practiceIds: string[] | null;
  selectedPracticeId?: string;
}): Promise<ArSummary> {
  const today = startOfTodayUtc();

  const practiceFilter = selectedPracticeId
    ? { practiceId: selectedPracticeId }
    : practiceIds === null
      ? {}
      : { practiceId: { in: practiceIds } };

  const batches = await prisma.arBatch.findMany({
    where: { status: BatchStatus.OPEN, ...practiceFilter },
    orderBy: { uploadedAt: "asc" },
    select: {
      id: true,
      reportMonth: true,
      reportYear: true,
      uploadedAt: true,
      totalClaims: true,
      totalBalance: true,
      practice: { select: { id: true, name: true } },
    },
  });

  const batchIds = batches.map((batch) => batch.id);

  const [byCategory, overdueCount] = await Promise.all([
    prisma.arClaim.groupBy({
      by: ["batchId", "statusCategory"],
      where: { batchId: { in: batchIds } },
      _count: { _all: true },
    }),
    prisma.arClaim.count({
      where: {
        batchId: { in: batchIds },
        statusCategory: StatusCategory.RED,
        followUpDate: { lt: today },
      },
    }),
  ]);

  const countFor = (batchId: string, category: StatusCategory) =>
    byCategory.find(
      (row) => row.batchId === batchId && row.statusCategory === category,
    )?._count._all ?? 0;

  let totalCents = 0n;
  let totalClaims = 0;
  let totalGreenClaims = 0;
  let totalRedClaims = 0;

  const practices: PracticeSummaryRow[] = batches.map((batch) => {
    const greenCount = countFor(batch.id, StatusCategory.GREEN);

    totalCents += toCents(batch.totalBalance.toString());
    totalClaims += batch.totalClaims;
    totalGreenClaims += greenCount;
    totalRedClaims += countFor(batch.id, StatusCategory.RED);

    return {
      practiceId: batch.practice.id,
      practiceName: batch.practice.name,
      batchId: batch.id,
      reportMonth: batch.reportMonth,
      reportYear: batch.reportYear,
      totalClaims: batch.totalClaims,
      greenCount,
      percentComplete:
        batch.totalClaims === 0
          ? 0
          : Math.round((greenCount / batch.totalClaims) * 100),
      daysOpen: daysBetween(batch.uploadedAt, new Date()),
    };
  });

  return {
    openBatchCount: batches.length,
    totalBalance: centsToDecimalString(totalCents),
    totalClaims,
    totalGreenClaims,
    totalRedClaims,
    overdueCount,
    percentComplete:
      totalClaims === 0
        ? 0
        : Math.round((totalGreenClaims / totalClaims) * 100),
    practices,
  };
}

/**
 * Per-biller throughput: how many of the claims currently assigned to them in
 * open batches have reached a green (biller-complete) status.
 */
export interface BillerProgress {
  userId: string;
  assignedClaims: number;
  completedClaims: number;
  percentComplete: number;
}

export async function billerProgress({
  practiceIds,
  selectedPracticeId,
}: {
  practiceIds: string[] | null;
  selectedPracticeId?: string;
}): Promise<Map<string, BillerProgress>> {
  const practiceFilter = selectedPracticeId
    ? { practiceId: selectedPracticeId }
    : practiceIds === null
      ? {}
      : { practiceId: { in: practiceIds } };

  const where = {
    assignedToId: { not: null },
    batch: { status: BatchStatus.OPEN, ...practiceFilter },
  };

  const [assigned, completed] = await Promise.all([
    prisma.arClaim.groupBy({
      by: ["assignedToId"],
      where,
      _count: { _all: true },
    }),
    prisma.arClaim.groupBy({
      by: ["assignedToId"],
      where: { ...where, statusCategory: StatusCategory.GREEN },
      _count: { _all: true },
    }),
  ]);

  const progress = new Map<string, BillerProgress>();

  for (const row of assigned) {
    if (!row.assignedToId) continue;

    const assignedClaims = row._count._all;
    const completedClaims =
      completed.find((entry) => entry.assignedToId === row.assignedToId)?._count
        ._all ?? 0;

    progress.set(row.assignedToId, {
      userId: row.assignedToId,
      assignedClaims,
      completedClaims,
      percentComplete:
        assignedClaims === 0
          ? 0
          : Math.round((completedClaims / assignedClaims) * 100),
    });
  }

  return progress;
}
