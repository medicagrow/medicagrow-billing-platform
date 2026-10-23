/**
 * Timer vocabulary with no Prisma behind it.
 *
 * `lib/task/timer.ts` holds the queries and re-exports this. The split is the
 * same one `lib/analytics/flags.ts` and `lib/productivity/ar-activities.ts`
 * make, and for the same reason: the analytics reports are imported by client
 * components, so anything they reach must not pull `pg` into the browser
 * bundle. It does, and the build says so.
 */

import { TimerReviewStatus } from "@/lib/generated/prisma/enums";

/**
 * The one condition that decides whether a session's hours count.
 *
 * An auto-stopped session is held at PENDING until a PM or Owner reviews it
 * (01 P1-01), and "not counted" has to mean everywhere — productivity, the
 * planner, efficiency, pace, a task's own total — or the figure somebody
 * questions will be the one place that forgot. Spread this into every query
 * that reads time rather than writing the comparison out again.
 */
export const COUNTED_SESSION_WHERE = {
  reviewStatus: { not: TimerReviewStatus.PENDING },
} as const;
