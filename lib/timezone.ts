/**
 * Timestamp display, in one timezone.
 *
 * Everything is **stored** in UTC and nothing here changes that. What these
 * helpers fix is the reading of it: the team works in India, so a note written
 * at 11:30 PM IST must not read as 6:00 PM on the previous day. A bare
 * `toLocaleString()` renders in whatever zone the machine happens to be in —
 * the server's on a server-rendered page, the viewer's on a client one — so
 * the same row could show two different times. Every conversion here names the
 * zone explicitly.
 *
 * **Date-only fields do not belong here.** Due dates, dates of service and
 * report months are calendar dates stored at UTC midnight; shifting them into
 * IST would move some of them a day. Those go through `formatDate()` in
 * [lib/format.ts](lib/format.ts), which stays on UTC deliberately.
 *
 * Free of Prisma and React, so client components and server components can
 * both import it.
 */

export const APP_TIMEZONE = "Asia/Kolkata";

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIMEZONE,
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

function toDate(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;

  const date = value instanceof Date ? value : new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

/** "08/05/2026, 11:30 PM" — a full timestamp in IST. */
export function formatDateTimeIST(
  value: Date | string | null | undefined,
  fallback = "—",
): string {
  const date = toDate(value);

  // Intl puts a comma between the date and the time; the spec's example has a
  // space, and the comma reads as a separator between two different values.
  return date ? dateTimeFormatter.format(date).replace(", ", " ") : fallback;
}

/** "08/05/2026" — the calendar date a timestamp falls on in IST. */
export function formatDateIST(
  value: Date | string | null | undefined,
  fallback = "—",
): string {
  const date = toDate(value);

  return date ? dateFormatter.format(date) : fallback;
}

/** "11:30 PM" — the time of day in IST. */
export function formatTimeIST(
  value: Date | string | null | undefined,
  fallback = "—",
): string {
  const date = toDate(value);

  return date ? timeFormatter.format(date) : fallback;
}
