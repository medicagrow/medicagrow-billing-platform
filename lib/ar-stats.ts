import { BatchStatus, StatusCategory } from "@/lib/generated/prisma/enums";
import { prisma } from "@/lib/prisma";

export interface BatchStats {
  totalClaims: number;
  greenCount: number;
  redCount: number;
  blueCount: number;
  unassignedCount: number;
  overdueCount: number;
  totalBalance: string;
  percentGreen: number;
  percentRed: number;
  percentBlue: number;
}

/** Start of today in UTC — the cut-off for "overdue follow-up". */
export function startOfTodayUtc(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

export function daysBetween(from: Date, to: Date): number {
  return Math.max(
    0,
    Math.floor((to.getTime() - from.getTime()) / 86_400_000),
  );
}

const percent = (part: number, whole: number) =>
  whole === 0 ? 0 : Math.round((part / whole) * 100);

export async function batchStats(batchId: string): Promise<BatchStats> {
  const today = startOfTodayUtc();

  const [byCategory, totals, unassignedCount, overdueCount] = await Promise.all([
    prisma.arClaim.groupBy({
      by: ["statusCategory"],
      where: { batchId },
      _count: { _all: true },
    }),
    prisma.arClaim.aggregate({
      where: { batchId },
      _sum: { balance: true },
      _count: true,
    }),
    prisma.arClaim.count({ where: { batchId, assignedToId: null } }),
    prisma.arClaim.count({
      where: {
        batchId,
        statusCategory: StatusCategory.RED,
        followUpDate: { lt: today },
      },
    }),
  ]);

  const countFor = (category: StatusCategory) =>
    byCategory.find((row) => row.statusCategory === category)?._count._all ?? 0;

  const totalClaims = totals._count;
  const greenCount = countFor(StatusCategory.GREEN);
  const redCount = countFor(StatusCategory.RED);
  const blueCount = countFor(StatusCategory.BLUE);

  return {
    totalClaims,
    greenCount,
    redCount,
    blueCount,
    unassignedCount,
    overdueCount,
    totalBalance: (totals._sum.balance ?? 0).toString(),
    percentGreen: percent(greenCount, totalClaims),
    percentRed: percent(redCount, totalClaims),
    percentBlue: percent(blueCount, totalClaims),
  };
}

export { BatchStatus };
