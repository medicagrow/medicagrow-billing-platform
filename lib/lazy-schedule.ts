/**
 * Rate limiting for the sweeps that stand in for a cron job.
 *
 * There is no scheduler in this deployment, so releasing held work and
 * generating due task occurrences happen when somebody loads a page. That is
 * reliable, but it also means the sweep runs on *every* load — an extra query
 * on a request that did not need one, and on a list page that is most of the
 * request.
 *
 * Both sweeps decide things at day granularity: a hold releases on a date, an
 * occurrence is due on a date. Deferring them by a few minutes cannot change
 * what they would have done, so a warm instance runs each at most once per
 * interval and the rest of its requests skip straight to reading.
 *
 * The clock is per instance and resets on a cold start, which is the right
 * trade: the cost of an unnecessary sweep is one query, and the cost of a
 * missed one would be work not appearing.
 */

/** Last run per scope key, in this instance. */
const lastRunAt = new Map<string, number>();

export const DEFAULT_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Runs `sweep` unless this key ran recently. Returns whether it ran.
 *
 * The key must name the **scope** of the work, not just the job: these
 * sweeps take an optional user, and one person's sweep must not suppress
 * another's.
 */
export async function runAtMostEvery(
  key: string,
  intervalMs: number,
  sweep: () => Promise<unknown>,
): Promise<boolean> {
  const now = Date.now();
  const previous = lastRunAt.get(key);

  if (previous !== undefined && now - previous < intervalMs) return false;

  // Claimed before awaiting, so two concurrent requests on one instance do
  // not both start the same sweep.
  lastRunAt.set(key, now);

  try {
    await sweep();
    return true;
  } catch (error) {
    // A failed sweep did not happen. Letting the timestamp stand would mean
    // one transient error suppressed the work for the whole interval.
    lastRunAt.delete(key);
    throw error;
  }
}

/** Test seam: forget every recorded run. */
export function resetSweepClock() {
  lastRunAt.clear();
}
