/**
 * The named windows the analytics filter bar offers.
 *
 * Free of React and Prisma so the pages, the filter bar and any server
 * component can resolve a preset the same way. A preset resolves to real
 * dates the moment it is chosen and the URL carries those dates, so a link
 * sent on Friday still opens on Monday showing the week it meant.
 */

export type AnalyticsPeriod =
  | "today"
  | "specific"
  | "this_week"
  | "last_week"
  | "this_month"
  | "last_month"
  | "this_quarter"
  | "custom";

export const ANALYTICS_PERIODS: { value: AnalyticsPeriod; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "specific", label: "Specific date" },
  { value: "this_week", label: "This week" },
  { value: "last_week", label: "Last week" },
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "this_quarter", label: "This quarter" },
  { value: "custom", label: "Custom range" },
];

/** Presets whose dates the person picks rather than the calendar. */
export const PICKS_ITS_OWN_DATES: AnalyticsPeriod[] = ["specific", "custom"];

const utcDay = (date: Date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

export function toDateParam(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function resolvePeriod(
  period: AnalyticsPeriod,
  now = new Date(),
): { from: Date; to: Date } {
  const today = utcDay(now);
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth();

  const shifted = (days: number) => {
    const date = new Date(today.getTime());
    date.setUTCDate(date.getUTCDate() + days);
    return date;
  };

  switch (period) {
    case "today":
    case "specific":
      return { from: today, to: today };

    case "this_week": {
      // The billing week starts Monday, which is how the team reports.
      const offset = (today.getUTCDay() + 6) % 7;
      return { from: shifted(-offset), to: shifted(6 - offset) };
    }

    case "last_week": {
      const offset = (today.getUTCDay() + 6) % 7;
      return { from: shifted(-offset - 7), to: shifted(-offset - 1) };
    }

    case "this_month":
      return {
        from: new Date(Date.UTC(year, month, 1)),
        to: new Date(Date.UTC(year, month + 1, 0)),
      };

    case "last_month":
      return {
        from: new Date(Date.UTC(year, month - 1, 1)),
        to: new Date(Date.UTC(year, month, 0)),
      };

    case "this_quarter": {
      const quarterStart = Math.floor(month / 3) * 3;
      return {
        from: new Date(Date.UTC(year, quarterStart, 1)),
        to: new Date(Date.UTC(year, quarterStart + 3, 0)),
      };
    }

    case "custom":
    default:
      return { from: new Date(Date.UTC(year, month, 1)), to: today };
  }
}
