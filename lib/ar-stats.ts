import { BatchStatus, StatusCategory } from "@/lib/generated/prisma/enums";
import { ACTIONABLE_WHERE, NOT_ACTIONABLE_WHERE } from "@/lib/ar-actionable";
import { prisma } from "@/lib/prisma";

export interface BatchStats {
  totalClaims: number;
  greenCount: number;
  redCount: number;
  blueCount: number;
  unassignedCount: number;
  overdueCount: number;
  totalBalance: string;
  /**
   * Completion percentages, over **actionable claims only** — 0–30 day claims
   * are out of both numerator and denominator. See lib/ar-actionable.ts.
   */
  percentGreen: number;
  percentRed: number;
  percentBlue: number;
  /** How many claims the percentages above left out, and how many remain. */
  notActionableCount: number;
  actionableClaims: number;
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

  /**
   * Two groupings, not one.
   *
   * The **counts** stay over every claim: the close dialog warns on red and
   * blue, and a batch of two hundred unworked fresh claims must not report
   * "nothing outstanding" simply because none of them is due yet.
   *
   * The **percentages** are over actionable claims only. A completion rate is
   * a judgement on the team, and claims nobody was allowed to work do not
   * belong in its denominator.
   */
  const [
    byCategory,
    actionableByCategory,
    totals,
    unassignedCount,
    overdueCount,
    notActionableCount,
  ] = await Promise.all([
    prisma.arClaim.groupBy({
      by: ["statusCategory"],
      where: { batchId },
      _count: { _all: true },
    }),
    prisma.arClaim.groupBy({
      by: ["statusCategory"],
      where: { batchId, ...ACTIONABLE_WHERE },
      _count: { _all: true },
    }),
    prisma.arClaim.aggregate({
      where: { batchId },
      _sum: { balance: true },
      _count: true,
    }),
    /**
     * Unassigned is a call to action — "these need giving to somebody" — so it
     * counts only what can actually be worked. A freshly uploaded batch would
     * otherwise wear a permanent amber warning nobody is able to clear.
     */
    prisma.arClaim.count({
      where: { batchId, assignedToId: null, ...ACTIONABLE_WHERE },
    }),
    prisma.arClaim.count({
      where: {
        batchId,
        statusCategory: StatusCategory.RED,
        followUpDate: { lt: today },
      },
    }),
    prisma.arClaim.count({ where: { batchId, ...NOT_ACTIONABLE_WHERE } }),
  ]);

  const countIn = (
    groups: { statusCategory: StatusCategory; _count: { _all: number } }[],
    category: StatusCategory,
  ) => groups.find((row) => row.statusCategory === category)?._count._all ?? 0;

  const totalClaims = totals._count;
  const actionableClaims = totalClaims - notActionableCount;

  return {
    totalClaims,
    greenCount: countIn(byCategory, StatusCategory.GREEN),
    redCount: countIn(byCategory, StatusCategory.RED),
    blueCount: countIn(byCategory, StatusCategory.BLUE),
    unassignedCount,
    overdueCount,
    totalBalance: (totals._sum.balance ?? 0).toString(),
    percentGreen: percent(
      countIn(actionableByCategory, StatusCategory.GREEN),
      actionableClaims,
    ),
    percentRed: percent(
      countIn(actionableByCategory, StatusCategory.RED),
      actionableClaims,
    ),
    percentBlue: percent(
      countIn(actionableByCategory, StatusCategory.BLUE),
      actionableClaims,
    ),
    notActionableCount,
    actionableClaims,
  };
}

export { BatchStatus };
