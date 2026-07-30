/**
 * Named reporting windows, shared by the API and the pages so a preset always
 * means the same thing on both sides. All boundaries are UTC, matching how
 * workedAt is stored.
 */

export type DateRangePreset =
  | "today"
  | "this_week"
  | "this_month"
  | "last_month"
  | "this_quarter"
  | "this_year"
  | "custom";

export const DATE_RANGE_PRESETS: { value: DateRangePreset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "this_week", label: "This Week" },
  { value: "this_month", label: "This Month" },
  { value: "last_month", label: "Last Month" },
  { value: "this_quarter", label: "This Quarter" },
  { value: "this_year", label: "This Year" },
  { value: "custom", label: "Custom" },
];

export const DEFAULT_PRESET: DateRangePreset = "this_month";

const utcDay = (date: Date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

/** End of day, so `workedAt <= to` includes everything logged that day. */
export function endOfDayUtc(date: Date): Date {
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      23,
      59,
      59,
      999,
    ),
  );
}

export function resolvePreset(
  preset: DateRangePreset,
  now = new Date(),
): { from: Date; to: Date } {
  const today = utcDay(now);
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth();

  switch (preset) {
    case "today":
      return { from: today, to: endOfDayUtc(today) };

    case "this_week": {
      // Week starts Monday, which is how billing teams report.
      const dayOfWeek = (today.getUTCDay() + 6) % 7;
      const monday = new Date(today);
      monday.setUTCDate(monday.getUTCDate() - dayOfWeek);
      return { from: monday, to: endOfDayUtc(today) };
    }

    case "this_month":
      return { from: new Date(Date.UTC(year, month, 1)), to: endOfDayUtc(today) };

    case "last_month":
      return {
        from: new Date(Date.UTC(year, month - 1, 1)),
        to: endOfDayUtc(new Date(Date.UTC(year, month, 0))),
      };

    case "this_quarter": {
      const quarterStartMonth = Math.floor(month / 3) * 3;
      return {
        from: new Date(Date.UTC(year, quarterStartMonth, 1)),
        to: endOfDayUtc(today),
      };
    }

    case "this_year":
      return { from: new Date(Date.UTC(year, 0, 1)), to: endOfDayUtc(today) };

    case "custom":
    default:
      return { from: new Date(Date.UTC(year, month, 1)), to: endOfDayUtc(today) };
  }
}

/** YYYY-MM-DD, the form used in query params. */
export function toDateParam(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Resolves the range from query params: explicit from/to win, otherwise the
 * named preset, otherwise the default.
 */
export function resolveRange(params: {
  preset?: string | null;
  from?: string | null;
  to?: string | null;
}): { from: Date; to: Date; preset: DateRangePreset } {
  const isDate = (value?: string | null): value is string =>
    Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));

  if (isDate(params.from) && isDate(params.to)) {
    const from = new Date(`${params.from}T00:00:00.000Z`);
    const to = endOfDayUtc(new Date(`${params.to}T00:00:00.000Z`));

    if (!Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime())) {
      const preset = (params.preset as DateRangePreset) ?? "custom";
      return { from, to, preset };
    }
  }

  const preset = (DATE_RANGE_PRESETS.some(
    (entry) => entry.value === params.preset,
  )
    ? params.preset
    : DEFAULT_PRESET) as DateRangePreset;

  return { ...resolvePreset(preset), preset };
}
