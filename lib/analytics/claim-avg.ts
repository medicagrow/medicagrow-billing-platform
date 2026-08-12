import { TaskStatus } from "@/lib/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { DAILY_HOURS_TASK_TYPE } from "@/lib/task/daily-hours";

/**
 * How long this biller actually takes per claim.
 *
 * The number that turns spare hours into "roughly how many claims can they
 * take". It comes from closed Claim Follow-up tasks, where both halves are
 * already recorded honestly: `totalLoggedMinutes` from the timer, and
 * `productivityCount` counted from the AR notes written inside those sessions
 * rather than typed in afterwards.
 *
 * Two rules keep it from lying:
 *
 *  - **A minimum of five tasks.** Two tasks is not a rate, it is an anecdote,
 *    and a capacity estimate built on one would be quoted to a client.
 *  - **Null, not zero, when there is not enough.** The caller falls back to the
 *    team average and says the number is estimated; silently reporting a very
 *    fast or very slow biller is worse than admitting the gap.
 */

/** Below this many closed tasks, one person's history is not a rate. */
export const MIN_DATA_POINTS = 5;

/** Averages move slowly; a page load should not re-derive one. */
const CACHE_TTL_MS = 60 * 60 * 1000;

interface CacheEntry {
  value: number | null;
  expiresAt: number;
}

/**
 * Per instance, cleared on a cold start — the same trade
 * [lib/lazy-schedule.ts](lib/lazy-schedule.ts) makes: the cost of a miss is
 * one grouped query, and the cost of staleness is bounded by the TTL.
 */
const cache = new Map<string, CacheEntry>();

function cached(key: string): CacheEntry | undefined {
  const entry = cache.get(key);

  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }

  return entry;
}

function remember(key: string, value: number | null): number | null {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

/** Test seam: forget every cached average. */
export function resetClaimAvgCache() {
  cache.clear();
}

/** Closed AR tasks that carry both halves of the ratio. */
const measurableWhere = (practiceId?: string) => ({
  status: TaskStatus.CLOSED,
  taskType: {
    is: { name: { equals: DAILY_HOURS_TASK_TYPE, mode: "insensitive" as const } },
  },
  productivityCount: { gt: 0 },
  totalLoggedMinutes: { gt: 0 },
  ...(practiceId ? { practiceId } : {}),
});

/**
 * Minutes per claim for one biller, or null when their history is too thin.
 *
 * The ratio is **summed then divided**, not averaged over per-task rates: a
 * task with two claims and one with two hundred are not equal evidence, and
 * averaging their rates would let the small one swing the answer.
 */
export async function getAvgMinutesPerClaim(
  userId: string,
  practiceId?: string,
): Promise<number | null> {
  const key = `user:${userId}:${practiceId ?? "all"}`;
  const hit = cached(key);
  if (hit) return hit.value;

  const result = await prisma.task.aggregate({
    where: { ...measurableWhere(practiceId), completedById: userId },
    _sum: { totalLoggedMinutes: true, productivityCount: true },
    _count: { _all: true },
  });

  if (result._count._all < MIN_DATA_POINTS) return remember(key, null);

  const minutes = result._sum.totalLoggedMinutes ?? 0;
  const claims = result._sum.productivityCount ?? 0;

  if (claims <= 0) return remember(key, null);

  return remember(key, Math.round((minutes / claims) * 10) / 10);
}

/**
 * The same figure across everybody — the fallback for a biller who has not
 * closed enough AR work yet, and for a new starter who has closed none.
 */
export async function getTeamAvgMinutesPerClaim(
  practiceId?: string,
): Promise<number | null> {
  const key = `team:${practiceId ?? "all"}`;
  const hit = cached(key);
  if (hit) return hit.value;

  const result = await prisma.task.aggregate({
    where: measurableWhere(practiceId),
    _sum: { totalLoggedMinutes: true, productivityCount: true },
    _count: { _all: true },
  });

  if (result._count._all < MIN_DATA_POINTS) return remember(key, null);

  const minutes = result._sum.totalLoggedMinutes ?? 0;
  const claims = result._sum.productivityCount ?? 0;

  if (claims <= 0) return remember(key, null);

  return remember(key, Math.round((minutes / claims) * 10) / 10);
}

export interface ClaimRate {
  minutesPerClaim: number | null;
  /** True when the biller's own history was too thin and the team's was used. */
  isTeamFallback: boolean;
}

/**
 * One call for "what rate should I plan this person at", resolved for a whole
 * roster at once so a capacity panel over ten billers is a fixed number of
 * round trips rather than ten.
 */
export async function claimRatesFor(
  userIds: string[],
  practiceId?: string,
): Promise<Map<string, ClaimRate>> {
  if (userIds.length === 0) return new Map();

  // One grouped query for the whole roster, not one per person — the rule
  // from the performance audit. `getAvgMinutesPerClaim` stays for the
  // single-biller callers and keeps its own cache.
  const [grouped, team] = await Promise.all([
    prisma.task.groupBy({
      by: ["completedById"],
      where: {
        ...measurableWhere(practiceId),
        completedById: { in: userIds },
      },
      _sum: { totalLoggedMinutes: true, productivityCount: true },
      _count: { _all: true },
    }),
    getTeamAvgMinutesPerClaim(practiceId),
  ]);

  const rates = new Map<string, ClaimRate>();

  for (const userId of userIds) {
    const row = grouped.find((entry) => entry.completedById === userId);

    const claims = row?._sum.productivityCount ?? 0;
    const minutes = row?._sum.totalLoggedMinutes ?? 0;

    const own =
      row && row._count._all >= MIN_DATA_POINTS && claims > 0
        ? Math.round((minutes / claims) * 10) / 10
        : null;

    rates.set(userId, {
      minutesPerClaim: own ?? team,
      isTeamFallback: own === null,
    });
  }

  return rates;
}
