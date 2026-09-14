import { BatchStatus, StatusCategory } from "@/lib/generated/prisma/enums";
import { ACTIONABLE_WHERE, NOT_ACTIONABLE_WHERE } from "@/lib/ar-actionable";
import { centsToDecimalString, toCents } from "@/lib/money";
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

/**
 * Per-batch figures for a **list** of batches, all over actionable claims.
 *
 * `batchStats()` above serves one batch page. This serves every surface that
 * shows many batches at once — the practices list, the batch history, the AR
 * dashboard table and both APIs behind them. The 0–30 day rule was applied to
 * the single-batch page and missed on all five of those, because each had its
 * own `groupBy` and each needed remembering separately. One function means the
 * rule is applied once.
 *
 * Four grouped queries whatever the number of batches — never one per batch.
 *
 * Everything is actionable-only **except** `notActionableCount` and
 * `notActionableBalance`, which exist so a page can say what it left out
 * rather than quietly showing a smaller number than the batch page does.
 */
export interface ListBatchStats {
  /** Claims aged past 30 days. */
  totalClaims: number;
  totalBalance: string;
  greenCount: number;
  redCount: number;
  blueCount: number;
  unassignedCount: number;
  overdueCount: number;
  /** green ÷ total, both actionable. */
  percentComplete: number;
  notActionableCount: number;
  notActionableBalance: string;
}

const EMPTY_LIST_STATS: ListBatchStats = {
  totalClaims: 0,
  totalBalance: "0.00",
  greenCount: 0,
  redCount: 0,
  blueCount: 0,
  unassignedCount: 0,
  overdueCount: 0,
  percentComplete: 0,
  notActionableCount: 0,
  notActionableBalance: "0.00",
};

export async function batchStatsFor(
  batchIds: string[],
  options: {
    /**
     * Narrows the counts to one person's claims — a biller's dashboard is
     * their own book. Not applied to `unassignedCount`: an unassigned claim
     * is by definition nobody's, so scoping it to a biller would always be 0.
     */
    assignedToId?: string;
  } = {},
): Promise<Map<string, ListBatchStats>> {
  const stats = new Map<string, ListBatchStats>();

  if (batchIds.length === 0) return stats;

  const today = startOfTodayUtc();
  const scope = options.assignedToId
    ? { assignedToId: options.assignedToId }
    : {};

  const inBatches = { batchId: { in: batchIds } };

  const [byCategory, unassigned, overdue, notActionable] = await Promise.all([
    // Counts and balance per status, actionable only — the totals are the sum.
    prisma.arClaim.groupBy({
      by: ["batchId", "statusCategory"],
      where: { ...inBatches, ...scope, ...ACTIONABLE_WHERE },
      _count: { _all: true },
      _sum: { balance: true },
    }),
    /**
     * A call to action — "these need giving to somebody" — so it counts only
     * what can be worked. A fresh batch would otherwise wear a permanent amber
     * badge nobody is able to clear.
     */
    prisma.arClaim.groupBy({
      by: ["batchId"],
      where: { ...inBatches, assignedToId: null, ...ACTIONABLE_WHERE },
      _count: { _all: true },
    }),
    prisma.arClaim.groupBy({
      by: ["batchId"],
      where: {
        ...inBatches,
        ...scope,
        ...ACTIONABLE_WHERE,
        statusCategory: StatusCategory.RED,
        followUpDate: { lt: today },
      },
      _count: { _all: true },
    }),
    // The context line: what the figures above deliberately leave out.
    prisma.arClaim.groupBy({
      by: ["batchId"],
      where: { ...inBatches, ...scope, ...NOT_ACTIONABLE_WHERE },
      _count: { _all: true },
      _sum: { balance: true },
    }),
  ]);

  for (const batchId of batchIds) {
    stats.set(batchId, { ...EMPTY_LIST_STATS });
  }

  // Balance summed in cents, never as floats — these are dollars.
  const cents = new Map<string, bigint>();

  for (const row of byCategory) {
    const entry = stats.get(row.batchId);
    if (!entry) continue;

    const count = row._count._all;

    entry.totalClaims += count;
    if (row.statusCategory === StatusCategory.GREEN) entry.greenCount += count;
    if (row.statusCategory === StatusCategory.RED) entry.redCount += count;
    if (row.statusCategory === StatusCategory.BLUE) entry.blueCount += count;

    cents.set(
      row.batchId,
      (cents.get(row.batchId) ?? 0n) + toCents(row._sum.balance?.toString()),
    );
  }

  for (const row of unassigned) {
    const entry = stats.get(row.batchId);
    if (entry) entry.unassignedCount = row._count._all;
  }

  for (const row of overdue) {
    const entry = stats.get(row.batchId);
    if (entry) entry.overdueCount = row._count._all;
  }

  for (const row of notActionable) {
    const entry = stats.get(row.batchId);
    if (!entry) continue;

    entry.notActionableCount = row._count._all;
    entry.notActionableBalance = centsToDecimalString(
      toCents(row._sum.balance?.toString()),
    );
  }

  for (const [batchId, entry] of stats) {
    entry.totalBalance = centsToDecimalString(cents.get(batchId) ?? 0n);
    entry.percentComplete = percent(entry.greenCount, entry.totalClaims);
  }

  return stats;
}

export { BatchStatus };
