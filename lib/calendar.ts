/**
 * Calendar helpers with no dependencies.
 *
 * Kept separate from lib/validations/common.ts so client components (the CSV
 * mapping preview) can normalise dates without pulling Zod into the bundle.
 */

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

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
