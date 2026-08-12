import { isWeekend, toIsoDate } from "@/lib/task/recurrence-config";

/**
 * AR follow-up is a **rate over a range**, not a deadline.
 *
 * Every other kind of task is a thing due on a day: the planner puts its whole
 * estimate on that day and moves on. Claim follow-up is not shaped like that —
 * a biller is given a practice's book for the month and spends two hours a day
 * on it. Recorded as a deadline it draws as one enormous Friday and nothing
 * else, which is the opposite of what is actually happening.
 *
 * So these tasks carry `startDate` and `dailyHours`, and the planner spreads
 * `dailyHours` across every **working day** between the start and the due date.
 * Two consequences fall out for free, and both are the point:
 *
 *  - **sequential** projects (Aug 1–15, then Aug 16–31) do not overlap; and
 *  - **simultaneous** ones (3h/day and 1h/day, both all month) add up to 4h/day
 *    rather than hiding behind each other.
 *
 * Free of Prisma so the task form can import the same rules the planner uses.
 */

/** The one task type this applies to. Matched by name, case-insensitively. */
export const DAILY_HOURS_TASK_TYPE = "Claim Follow-up";

export const MIN_DAILY_HOURS = 0.5;
export const MAX_DAILY_HOURS = 8;
export const DAILY_HOURS_STEP = 0.5;

export function usesDailyHours(taskTypeName: string | null | undefined) {
  return (
    (taskTypeName ?? "").trim().toLowerCase() ===
    DAILY_HOURS_TASK_TYPE.toLowerCase()
  );
}

export interface SpreadableTask {
  startDate: Date | null;
  dueDate: Date | null;
  createdAt: Date;
  dailyHours: unknown;
}

/**
 * The hours-per-day as a number, or null when the task has none.
 *
 * Null is **not** zero. A Claim Follow-up with no `dailyHours` has not been
 * configured, and the planner reports it separately rather than quietly
 * treating that biller as having nothing on.
 */
export function dailyHoursOf(task: { dailyHours: unknown }): number | null {
  if (task.dailyHours === null || task.dailyHours === undefined) return null;

  const hours = Number(task.dailyHours);

  return Number.isFinite(hours) && hours > 0 ? hours : null;
}

/**
 * The days this task actually occupies, clipped to the window being drawn.
 *
 * Starts at `startDate`, or the day the task was created when none was given —
 * work that has been assigned is being done from the moment it lands, and
 * treating an unset start as "the epoch" would smear an hour a day across
 * years. Weekends are skipped: a daily rate is a working-day rate.
 */
export function spreadDays(
  task: SpreadableTask,
  windowFrom: Date,
  windowTo: Date,
): string[] {
  if (!task.dueDate) return [];

  const from = task.startDate ?? task.createdAt;

  // Clip to the window before walking, so a year-long task costs a handful of
  // iterations rather than 365.
  const start = from > windowFrom ? from : windowFrom;
  const end = task.dueDate < windowTo ? task.dueDate : windowTo;

  if (start > end) return [];

  const days: string[] = [];
  const cursor = new Date(
    Date.UTC(
      start.getUTCFullYear(),
      start.getUTCMonth(),
      start.getUTCDate(),
      0,
      0,
      0,
      0,
    ),
  );

  const last = toIsoDate(end);

  while (toIsoDate(cursor) <= last) {
    if (!isWeekend(cursor)) days.push(toIsoDate(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return days;
}

/** Working days between two dates, inclusive — the capacity denominator. */
export function workingDaysBetween(from: Date, to: Date): number {
  if (from > to) return 0;

  const cursor = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()),
  );

  const last = toIsoDate(to);
  let count = 0;

  while (toIsoDate(cursor) <= last) {
    if (!isWeekend(cursor)) count++;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return count;
}
