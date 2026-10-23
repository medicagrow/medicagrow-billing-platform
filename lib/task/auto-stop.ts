/**
 * Stopping timers nobody stopped (01 P1-01, CALC-02).
 *
 * A forgotten timer used to run until the person started their next one,
 * which is how the book ended up with 44 sessions over ten hours, 19 over a
 * day, and a single session of six days. Those hours landed on one date and
 * inflated every figure built on them: time and productivity, the planner's
 * red cells, efficiency, over-capacity counts.
 *
 * The sweep stops any timer past the cap and marks the session PENDING, which
 * takes it out of every report until a PM or Owner reviews it. It does not
 * guess an end time — the hours are not written off, they are held until
 * somebody who knows says what happened.
 */

import { prisma } from "@/lib/prisma";
import { TimerReviewStatus } from "@/lib/generated/prisma/enums";
import { getMaxSessionMinutes } from "@/lib/app-settings";
import { runAtMostEvery, DEFAULT_SWEEP_INTERVAL_MS } from "@/lib/lazy-schedule";
import { minutesBetween, recalculateTotalLoggedMinutes } from "@/lib/task/timer";

export interface AutoStopResult {
  stopped: number;
  /** Minutes held back from reports, pending review. */
  pendingMinutes: number;
}

/**
 * Stops every timer that has run past the cap.
 *
 * The stop time is the cap, not now: a timer left running over a weekend
 * would otherwise record the weekend. The real end time is whatever the
 * reviewer sets, between the start and this.
 */
export async function autoStopRunawayTimers(
  now = new Date(),
  options: {
    /**
     * Narrows the sweep to these people. Production never passes it — a
     * forgotten timer is forgotten whoever owns it — but a test must be able
     * to act on its own fixtures without stopping a real biller's clock as a
     * side effect.
     */
    userIds?: string[];
  } = {},
): Promise<AutoStopResult> {
  const maxMinutes = await getMaxSessionMinutes();
  const cutoff = new Date(now.getTime() - maxMinutes * 60_000);

  const running = await prisma.task.findMany({
    where: {
      activeTimerUserId: options.userIds?.length
        ? { in: options.userIds }
        : { not: null },
      activeTimerStartedAt: { not: null, lt: cutoff },
    },
    select: { id: true, activeTimerUserId: true, activeTimerStartedAt: true },
  });

  if (running.length === 0) return { stopped: 0, pendingMinutes: 0 };

  let pendingMinutes = 0;

  for (const task of running) {
    const startedAt = task.activeTimerStartedAt;
    const userId = task.activeTimerUserId;
    if (!startedAt || !userId) continue;

    const stoppedAt = new Date(startedAt.getTime() + maxMinutes * 60_000);
    const durationMinutes = minutesBetween(startedAt, stoppedAt);

    await prisma.taskTimeLog.create({
      data: {
        taskId: task.id,
        userId,
        startedAt,
        stoppedAt,
        durationMinutes,
        autoStopped: true,
        autoStoppedAt: now,
        reviewStatus: TimerReviewStatus.PENDING,
      },
    });

    /**
     * Cleared with a guard on the timer still being the one we just stopped:
     * the person may have stopped it themselves between the read and here,
     * and clearing unconditionally would wipe a timer they had restarted.
     */
    await prisma.task.updateMany({
      where: { id: task.id, activeTimerStartedAt: startedAt },
      data: { activeTimerStartedAt: null, activeTimerUserId: null },
    });

    // Excludes the pending session, so the task's total stays honest.
    await recalculateTotalLoggedMinutes(task.id);

    pendingMinutes += durationMinutes;
  }

  return { stopped: running.length, pendingMinutes };
}

/**
 * Rate-limited, for the request path. The cap is measured in hours, so
 * deferring the sweep by a few minutes cannot change what it does — the same
 * reasoning the hold-release and recurrence sweeps rest on.
 */
export async function autoStopRunawayTimersIfNeeded(): Promise<void> {
  await runAtMostEvery("auto-stop-timers", DEFAULT_SWEEP_INTERVAL_MS, () =>
    autoStopRunawayTimers(),
  );
}
