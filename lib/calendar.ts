/**
 * Calendar helpers with no dependencies.
 *
 * Kept separate from lib/validations/common.ts so client components (the CSV
 * mapping preview) can normalise dates without pulling Zod into the bundle.
 */

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * The window a stored date may fall in.
 *
 * A date outside it is a typing accident, not a business fact: a year typed as
 * 0206 or 2206 passes every calendar check — the day exists, the month exists
 * — and then poisons whatever averages it. One such EOB batch date turned
 * "average days to resolve" into 2,428 days against a median of 6.
 *
 * Deliberately wide. The point is to catch a mistyped year, not to police
 * which dates a biller may enter: a 2019 claim is unusual but real, and a
 * follow-up two years out is odd but not impossible. Narrower rules belong
 * with the field that needs them (see the follow-up rules in validations/ar).
 */
export const MIN_DATE_YEAR = 2000;
export const MAX_DATE_YEARS_AHEAD = 2;

/** Midnight UTC today — the day boundary every daily calculation uses. */
export function startOfTodayUtcDate(now = new Date()): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

/**
 * True when a YYYY-MM-DD date is inside the supported window. Assumes the
 * string is already a real calendar date — `isValidCalendarDate` answers that.
 */
export function isDateWithinSupportedRange(value: string, now = new Date()) {
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  if (year < MIN_DATE_YEAR) return false;

  return year <= now.getUTCFullYear() + MAX_DATE_YEARS_AHEAD;
}

export function isLeapYear(year: number) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number) {
  const lengths = [
    31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
  ];
  return lengths[month - 1] ?? 0;
}

/**
 * True only for dates that exist on the calendar. Rejects 2026-02-30,
 * 2026-04-31 and 2026-02-29, and accepts 2024-02-29.
 */
export function isValidCalendarDate(value: string) {
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (month < 1 || month > 12) return false;
  if (day < 1 || day > daysInMonth(year, month)) return false;

  return true;
}
