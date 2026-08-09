/**
 * Task recurrence config: types, parsing and date arithmetic.
 *
 * Deliberately **free of Prisma** so the create/edit form can import it
 * without pulling pg into the browser bundle. The generator that writes rows
 * lives in ./recurrence.ts.
 */

export type RecurringFrequency = "daily" | "weekly" | "biweekly" | "monthly";

export interface RecurringConfig {
  frequency: RecurringFrequency;
  /** Weekly and bi-weekly: 0 = Sunday … 6 = Saturday. */
  daysOfWeek?: number[];
  /** Monthly: 1–28, so every month has the day. */
  dayOfMonth?: number;
  /** ISO date (YYYY-MM-DD) of the next occurrence still to be generated. */
  nextDueDate: string;
  /** Optional ISO date after which the series stops. */
  endDate?: string;
}

export const FREQUENCY_LABELS: Record<RecurringFrequency, string> = {
  daily: "Daily",
  weekly: "Weekly",
  biweekly: "Bi-weekly",
  monthly: "Monthly",
};

export const DAY_NAMES = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
] as const;

/** Mon–Fri, the default working week. */
export const WEEKDAYS = [1, 2, 3, 4, 5];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** UTC midnight for a YYYY-MM-DD string. */
export function toUtcDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Reads a stored config, returning null for anything malformed rather than
 * throwing — a bad JSON blob must not take a whole list page down.
 */
export function parseRecurringConfig(value: unknown): RecurringConfig | null {
  if (!value || typeof value !== "object") return null;

  const raw = value as Record<string, unknown>;

  const frequency = raw.frequency;
  if (
    frequency !== "daily" &&
    frequency !== "weekly" &&
    frequency !== "biweekly" &&
    frequency !== "monthly"
  ) {
    return null;
  }

  if (typeof raw.nextDueDate !== "string" || !ISO_DATE.test(raw.nextDueDate)) {
    return null;
  }

  const daysOfWeek = Array.isArray(raw.daysOfWeek)
    ? raw.daysOfWeek
        .map((day) => Number(day))
        .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    : undefined;

  const dayOfMonth =
    Number.isInteger(Number(raw.dayOfMonth)) &&
    Number(raw.dayOfMonth) >= 1 &&
    Number(raw.dayOfMonth) <= 28
      ? Number(raw.dayOfMonth)
      : undefined;

  return {
    frequency,
    ...(daysOfWeek && daysOfWeek.length > 0 ? { daysOfWeek } : {}),
    ...(dayOfMonth ? { dayOfMonth } : {}),
    nextDueDate: raw.nextDueDate,
    ...(typeof raw.endDate === "string" && ISO_DATE.test(raw.endDate)
      ? { endDate: raw.endDate }
      : {}),
  };
}

/**
 * The occurrence after `from`, or null once the series has ended.
 *
 * Weekly and bi-weekly walk forward day by day to the next selected weekday,
 * which handles the wrap across a week boundary without special cases. Their
 * only difference is that bi-weekly skips a week once it wraps.
 */
/** Saturday or Sunday, in UTC — the days nobody is working billing. */
export function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

/**
 * The next working day after `date`.
 *
 * "Daily" means every business day: a queue that fills up over a weekend
 * nobody worked is two tasks that were never going to be done, and the
 * Monday catch-up then looks like a backlog rather than a fresh day.
 */
export function nextBusinessDay(date: Date): Date {
  const next = new Date(date.getTime());

  next.setUTCDate(next.getUTCDate() + 1);
  while (isWeekend(next)) next.setUTCDate(next.getUTCDate() + 1);

  return next;
}

export function nextOccurrence(
  config: RecurringConfig,
  from: Date,
): Date | null {
  const cursor = new Date(from.getTime());
  let next: Date;

  if (config.frequency === "daily") {
    // Weekdays only. Weekly and bi-weekly already say which days they run on,
    // and monthly lands on a date rather than a day, so this is the one
    // frequency that had to be told.
    next = nextBusinessDay(cursor);
  } else if (config.frequency === "monthly") {
    const day = config.dayOfMonth ?? Math.min(28, cursor.getUTCDate());
    next = new Date(
      Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, day),
    );
  } else {
    const days = (config.daysOfWeek ?? [cursor.getUTCDay()])
      .slice()
      .sort((a, b) => a - b);

    if (days.length === 0) return null;

    let wrapped = false;

    // At most 7 steps reaches every weekday exactly once.
    for (let step = 1; step <= 7; step += 1) {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      if (cursor.getUTCDay() === 0) wrapped = true;
      if (days.includes(cursor.getUTCDay())) break;
    }

    // Bi-weekly runs on alternate weeks, so crossing into a new week costs
    // an extra seven days.
    if (config.frequency === "biweekly" && wrapped) {
      cursor.setUTCDate(cursor.getUTCDate() + 7);
    }

    next = cursor;
  }

  if (config.endDate && toIsoDate(next) > config.endDate) return null;

  return next;
}

/** The next `count` occurrences starting at (and including) `nextDueDate`. */
export function upcomingOccurrences(
  config: RecurringConfig,
  count: number,
): Date[] {
  const dates: Date[] = [];
  let cursor = toUtcDate(config.nextDueDate);

  if (config.endDate && config.nextDueDate > config.endDate) return dates;

  /**
   * A daily series set up on a Saturday starts on the Monday. Without this the
   * first occurrence would land on a weekend that the rest of the schedule is
   * careful to avoid.
   */
  if (config.frequency === "daily" && isWeekend(cursor)) {
    while (isWeekend(cursor)) {
      cursor = new Date(cursor.getTime() + 86_400_000);
    }

    if (config.endDate && toIsoDate(cursor) > config.endDate) return dates;
  }

  dates.push(cursor);

  while (dates.length < count) {
    const next = nextOccurrence(config, cursor);
    if (!next) break;
    dates.push(next);
    cursor = next;
  }

  return dates;
}

/** One-line summary for a list row or a form hint. */
export function describeRecurrence(config: RecurringConfig): string {
  if (config.frequency === "daily") return "Every day";

  if (config.frequency === "monthly") {
    return `Monthly on day ${config.dayOfMonth ?? 1}`;
  }

  const days = (config.daysOfWeek ?? [])
    .slice()
    .sort((a, b) => a - b)
    .map((day) => DAY_NAMES[day])
    .join(", ");

  const prefix = config.frequency === "biweekly" ? "Every 2 weeks" : "Weekly";

  return days ? `${prefix} on ${days}` : prefix;
}
