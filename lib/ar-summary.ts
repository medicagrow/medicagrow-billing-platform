import { BatchStatus, Role, StatusCategory } from "@/lib/generated/prisma/enums";
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
  assignedToId,
}: {
  /** null means "every practice" (Owner). */
  practiceIds: string[] | null;
  selectedPracticeId?: string;
  /**
   * Narrows every figure to one person's claims. A biller's dashboard is
   * their own book of work, not the practice's.
   */
  assignedToId?: string;
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

  const claimScope = assignedToId ? { assignedToId } : {};

  const [byCategory, overdueCount, ownTotals] = await Promise.all([
    prisma.arClaim.groupBy({
      by: ["batchId", "statusCategory"],
      where: { batchId: { in: batchIds }, ...claimScope },
      _count: { _all: true },
    }),
    prisma.arClaim.count({
      where: {
        batchId: { in: batchIds },
        statusCategory: StatusCategory.RED,
        followUpDate: { lt: today },
        ...claimScope,
      },
    }),
    // A batch's own totals count claims that were never this biller's, so
    // their per-batch totals are recomputed from the claims they hold.
    assignedToId
      ? prisma.arClaim.groupBy({
          by: ["batchId"],
          where: { batchId: { in: batchIds }, ...claimScope },
          _count: { _all: true },
          _sum: { balance: true },
        })
      : Promise.resolve([]),
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

    const own = ownTotals.find((row) => row.batchId === batch.id);
    const batchClaims = assignedToId
      ? (own?._count._all ?? 0)
      : batch.totalClaims;
    const batchBalance = assignedToId
      ? (own?._sum.balance?.toString() ?? "0.00")
      : batch.totalBalance.toString();

    totalCents += toCents(batchBalance);
    totalClaims += batchClaims;
    totalGreenClaims += greenCount;
    totalRedClaims += countFor(batch.id, StatusCategory.RED);

    return {
      practiceId: batch.practice.id,
      practiceName: batch.practice.name,
      batchId: batch.id,
      reportMonth: batch.reportMonth,
      reportYear: batch.reportYear,
      totalClaims: batchClaims,
      greenCount,
      percentComplete:
        batchClaims === 0 ? 0 : Math.round((greenCount / batchClaims) * 100),
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
 * The biller productivity panel: who is in scope, and how many notes each of
 * them logged today, this week and this month.
 *
 * Both halves are scoped to the practices in view. A PM oversees practices,
 * not people, so a biller shared with another practice appears here only for
 * the work they did on the PM's own — and a biller they share nothing with
 * does not appear at all.
 */
export interface ArBillerActivity {
  id: string;
  name: string;
  role: Role;
  today: number;
  thisWeek: number;
  thisMonth: number;
}

export async function arBillerActivity({
  practiceIds,
  selectedPracticeId,
}: {
  /** null means "every practice" (Owner). */
  practiceIds: string[] | null;
  selectedPracticeId?: string;
}): Promise<ArBillerActivity[]> {
  const today = startOfTodayUtc();

  const startOfWeek = new Date(today);
  startOfWeek.setUTCDate(startOfWeek.getUTCDate() - 6);

  const startOfMonth = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1),
  );

  const scoped = selectedPracticeId ? [selectedPracticeId] : practiceIds;

  const noteScope =
    scoped === null
      ? {}
      : { claim: { batch: { practiceId: { in: scoped } } } };

  const countsSince = (since: Date) =>
    prisma.arWorkNote.groupBy({
      by: ["workedById"],
      where: { workedAt: { gte: since }, ...noteScope },
      _count: { _all: true },
    });

  const [todayNotes, weekNotes, monthNotes, users] = await Promise.all([
    countsSince(today),
    countsSince(startOfWeek),
    countsSince(startOfMonth),
    prisma.user.findMany({
      where: {
        isActive: true,
        role: { in: [Role.BILLER, Role.PROJECT_MANAGER] },
        ...(practiceIds === null
          ? {}
          : { practices: { some: { practiceId: { in: practiceIds } } } }),
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true, role: true },
    }),
  ]);

  const noteCount = (
    groups: { workedById: string; _count: { _all: number } }[],
    userId: string,
  ) => groups.find((row) => row.workedById === userId)?._count._all ?? 0;

  return users.map((user) => ({
    id: user.id,
    name: user.name,
    role: user.role,
    today: noteCount(todayNotes, user.id),
    thisWeek: noteCount(weekNotes, user.id),
    thisMonth: noteCount(monthNotes, user.id),
  }));
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
