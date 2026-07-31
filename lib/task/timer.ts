import { prisma } from "@/lib/prisma";

/**
 * Task timers.
 *
 * One running timer per user, platform-wide: starting a second one stops the
 * first rather than letting two clocks run against the same person's day.
 * A stopped timer becomes a TaskTimeLog, and `task.totalLoggedMinutes` is
 * recalculated from those logs rather than incremented, so an approved edit
 * cannot leave the total drifting from the rows behind it.
 */

/** Editing a log is allowed the same day and the next — 48 hours. */
export const EDIT_WINDOW_HOURS = 48;

export function minutesBetween(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 60_000));
}

export function isWithinEditWindow(startedAt: Date, now = new Date()): boolean {
  return now.getTime() - startedAt.getTime() <= EDIT_WINDOW_HOURS * 3_600_000;
}

/** Sums the task's logs and writes the total back. Returns the new total. */
export async function recalculateTotalLoggedMinutes(
  taskId: string,
): Promise<number> {
  const aggregate = await prisma.taskTimeLog.aggregate({
    where: { taskId, durationMinutes: { not: null } },
    _sum: { durationMinutes: true },
  });

  const total = aggregate._sum.durationMinutes ?? 0;

  await prisma.task.update({
    where: { id: taskId },
    data: { totalLoggedMinutes: total },
  });

  return total;
}

export interface StoppedTimer {
  taskId: string;
  logId: string;
  durationMinutes: number;
}

/**
 * Stops whatever timer this user has running, wherever it is, and writes the
 * log. Returns null when they had none.
 */
export async function stopActiveTimerFor(
  userId: string,
  now = new Date(),
): Promise<StoppedTimer | null> {
  const running = await prisma.task.findFirst({
    where: { activeTimerUserId: userId, activeTimerStartedAt: { not: null } },
    select: { id: true, activeTimerStartedAt: true },
  });

  if (!running?.activeTimerStartedAt) return null;

  const startedAt = running.activeTimerStartedAt;

  const log = await prisma.taskTimeLog.create({
    data: {
      taskId: running.id,
      userId,
      startedAt,
      stoppedAt: now,
      durationMinutes: minutesBetween(startedAt, now),
    },
  });

  await prisma.task.update({
    where: { id: running.id },
    data: { activeTimerStartedAt: null, activeTimerUserId: null },
  });

  await recalculateTotalLoggedMinutes(running.id);

  return {
    taskId: running.id,
    logId: log.id,
    durationMinutes: log.durationMinutes ?? 0,
  };
}

export interface OverlapConflict {
  taskId: string;
  logId: string;
  startedAt: Date;
  stoppedAt: Date | null;
}

/**
 * A person cannot be in two places at once, so an edited range must not land
 * on top of another log of theirs. Checked at approval time, when the new
 * range is finally known.
 */
export async function findOverlappingLog(
  userId: string,
  from: Date,
  to: Date,
  excludeLogId: string,
): Promise<OverlapConflict | null> {
  // Bound the scan to the calendar day either side of the range rather than
  // every log the person has ever recorded.
  const dayStart = new Date(from.getTime());
  dayStart.setUTCHours(0, 0, 0, 0);

  const dayEnd = new Date(to.getTime());
  dayEnd.setUTCHours(23, 59, 59, 999);

  const sameDay = await prisma.taskTimeLog.findMany({
    where: {
      userId,
      id: { not: excludeLogId },
      startedAt: { gte: dayStart, lte: dayEnd },
      stoppedAt: { not: null },
    },
    select: { id: true, taskId: true, startedAt: true, stoppedAt: true },
  });

  // Half-open comparison: one log ending exactly when the next begins is
  // adjacent, not overlapping.
  const clash = sameDay.find(
    (log) => log.startedAt < to && (log.stoppedAt as Date) > from,
  );

  return clash
    ? {
        taskId: clash.taskId,
        logId: clash.id,
        startedAt: clash.startedAt,
        stoppedAt: clash.stoppedAt,
      }
    : null;
}
