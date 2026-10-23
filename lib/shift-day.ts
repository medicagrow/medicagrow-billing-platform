/**
 * Shift day — the date a shift started, which is the date its work belongs to.
 *
 * Every daily figure should bucket by this rather than by a calendar date in
 * some arbitrary zone: timer totals, productivity, workload, AR pace, My Day,
 * overdue checks (02 F-01).
 *
 * **In Phase 1 this returns the UTC date, and that is already correct for both
 * shifts**, which is why the stub is safe rather than a placeholder that lies:
 *
 *   Day shift   09:00–19:00 IST  =  03:30–13:30 UTC, same UTC date
 *   Night shift 18:30–05:00 IST  =  13:00–23:30 UTC, same UTC date
 *
 * IST is UTC+5:30, so a night shift that crosses midnight IST does **not**
 * cross midnight UTC — 02:00 IST on the 24th is 20:30 UTC on the 23rd, and
 * the 23rd is the date that shift started. A calendar date in IST would be the
 * wrong answer there; the UTC date is the right one.
 *
 * What F-01 adds is the per-user shift assignment, which this signature
 * already takes. Call it everywhere now and Phase 2 changes one function.
 */

import { startOfTodayUtcDate } from "@/lib/calendar";

/** The shift day a moment belongs to, as YYYY-MM-DD. */
export function getShiftDay(
  _userId: string,
  timestamp: Date = new Date(),
): string {
  return timestamp.toISOString().slice(0, 10);
}

/** Today's shift day for this user. */
export function currentShiftDay(userId: string): string {
  return getShiftDay(userId, startOfTodayUtcDate());
}
