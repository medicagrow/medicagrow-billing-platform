/**
 * Recurring todo scheduling.
 *
 * A recurring todo is a template; instances are generated ahead of time so
 * they show up in daily planning. Completing an instance tops the series up,
 * so a long-lived series never runs dry.
 */

export const GENERATION_WINDOW_DAYS = 60;

export interface RecurringConfig {
  frequency: "daily" | "weekly" | "monthly";
  /** Weekly only: 0 = Sunday … 6 = Saturday. */
  daysOfWeek?: number[];
  /** Monthly only: 1–31, clamped to the month's length. */
  dayOfMonth?: number;
  /** Optional YYYY-MM-DD stop date. */
  endDate?: string;
}

export function parseRecurringConfig(value: unknown): RecurringConfig | null {
  if (!value || typeof value !== "object") return null;

  const config = value as Record<string, unknown>;
  const frequency = config.frequency;

  if (frequency !== "daily" && frequency !== "weekly" && frequency !== "monthly") {
    return null;
  }

  const daysOfWeek = Array.isArray(config.daysOfWeek)
    ? config.daysOfWeek
        .map((day) => Number(day))
        .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    : undefined;

  // A weekly series with no days selected would never fire.
  if (frequency === "weekly" && (!daysOfWeek || daysOfWeek.length === 0)) {
    return null;
  }

  const dayOfMonth =
    typeof config.dayOfMonth === "number" || typeof config.dayOfMonth === "string"
      ? Math.min(31, Math.max(1, Math.trunc(Number(config.dayOfMonth))))
      : undefined;

  if (frequency === "monthly" && !dayOfMonth) return null;

  const endDate =
    typeof config.endDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(config.endDate)
      ? config.endDate
      : undefined;

  return { frequency, daysOfWeek, dayOfMonth, endDate };
}

const utcDay = (date: Date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

/** Day-of-month clamped to the target month, so the 31st works in February. */
function monthlyOccurrence(from: Date, dayOfMonth: number, monthOffset: number) {
  const year = from.getUTCFullYear();
  const month = from.getUTCMonth() + monthOffset;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(dayOfMonth, lastDay)));
}

/**
 * The next due date strictly after `after`, or null when the series has ended.
 */
export function generateNextInstance(
  config: RecurringConfig,
  after: Date,
): Date | null {
  const start = utcDay(after);
  const end = config.endDate
    ? new Date(`${config.endDate}T00:00:00.000Z`)
    : null;

  let next: Date | null = null;

  if (config.frequency === "daily") {
    next = addDays(start, 1);
  } else if (config.frequency === "weekly") {
    const days = [...(config.daysOfWeek ?? [])].sort((a, b) => a - b);
    if (days.length === 0) return null;

    // Walk forward at most a full week to find the next selected weekday.
    for (let offset = 1; offset <= 7; offset += 1) {
      const candidate = addDays(start, offset);
      if (days.includes(candidate.getUTCDay())) {
        next = candidate;
        break;
      }
    }
  } else {
    const dayOfMonth = config.dayOfMonth ?? 1;
    const thisMonth = monthlyOccurrence(start, dayOfMonth, 0);
    next =
      thisMonth.getTime() > start.getTime()
        ? thisMonth
        : monthlyOccurrence(start, dayOfMonth, 1);
  }

  if (!next) return null;
  if (end && next.getTime() > end.getTime()) return null;

  return next;
}

/**
 * Every occurrence in the generation window, starting from `from` inclusive.
 * Used when a recurring todo is first created.
 */
export function generateInstances(
  config: RecurringConfig,
  from: Date,
  windowDays = GENERATION_WINDOW_DAYS,
): Date[] {
  const start = utcDay(from);
  const limit = addDays(start, windowDays);
  const end = config.endDate
    ? new Date(`${config.endDate}T00:00:00.000Z`)
    : null;

  const dates: Date[] = [];

  // The start date itself counts when it matches the pattern.
  const matchesStart =
    config.frequency === "daily" ||
    (config.frequency === "weekly" &&
      (config.daysOfWeek ?? []).includes(start.getUTCDay())) ||
    (config.frequency === "monthly" &&
      start.getUTCDate() ===
        Math.min(
          config.dayOfMonth ?? 1,
          new Date(
            Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0),
          ).getUTCDate(),
        ));

  if (matchesStart && (!end || start.getTime() <= end.getTime())) {
    dates.push(start);
  }

  let cursor = start;

  // Bounded loop: at most one instance per day in the window.
  for (let guard = 0; guard < windowDays + 1; guard += 1) {
    const next = generateNextInstance(config, cursor);
    if (!next || next.getTime() > limit.getTime()) break;

    dates.push(next);
    cursor = next;
  }

  return dates;
}

export function describeRecurrence(config: RecurringConfig): string {
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const base =
    config.frequency === "daily"
      ? "Every day"
      : config.frequency === "weekly"
        ? `Every ${(config.daysOfWeek ?? [])
            .sort((a, b) => a - b)
            .map((day) => dayNames[day])
            .join(", ")}`
        : `Monthly on day ${config.dayOfMonth}`;

  return config.endDate ? `${base}, until ${config.endDate}` : base;
}
