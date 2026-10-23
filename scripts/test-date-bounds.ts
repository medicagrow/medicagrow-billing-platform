/**
 * Date range bounds and the follow-up date rules (P1-04, P1-07).
 *
 *   npx tsx scripts/test-date-bounds.ts
 *
 * Pure validation checks — no database, no fixtures. The year bound is the one
 * that was missing: 0206-10-02 and 2206-08-12 are real calendar dates, so
 * every existing check passed them and one of them turned the EOB resolution
 * average into 2,428 days.
 */

import {
  isDateWithinSupportedRange,
  isValidCalendarDate,
  MAX_DATE_YEARS_AHEAD,
  MIN_DATE_YEAR,
  startOfTodayUtcDate,
} from "../lib/calendar";
import {
  bulkFollowUpSchema,
  createWorkNoteSchema,
  FOLLOW_UP_CONFIRM_DAYS,
  isFollowUpFarOut,
  isFollowUpInPast,
} from "../lib/validations/ar";
import { dateSchema, dateStringSchema } from "../lib/validations/common";

let pass = 0;
let fail = 0;

function check(label: string, ok: boolean, detail = "") {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

/** YYYY-MM-DD this many days from today, UTC. */
function isoIn(days: number): string {
  const date = startOfTodayUtcDate();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const thisYear = new Date().getUTCFullYear();

console.log("=== the year bound ===");

check("0206-10-02 is a real calendar date", isValidCalendarDate("0206-10-02"));
check(
  "…but is out of range",
  !isDateWithinSupportedRange("0206-10-02"),
  "the EOB batch date behind CALC-03",
);
check("2206-08-12 is out of range", !isDateWithinSupportedRange("2206-08-12"));
check("0001-01-01 is out of range", !isDateWithinSupportedRange("0001-01-01"));
check(
  `${MIN_DATE_YEAR}-01-01 is the floor and is allowed`,
  isDateWithinSupportedRange(`${MIN_DATE_YEAR}-01-01`),
);
check(
  `${MIN_DATE_YEAR - 1}-12-31 is below the floor`,
  !isDateWithinSupportedRange(`${MIN_DATE_YEAR - 1}-12-31`),
);
check(
  `${MAX_DATE_YEARS_AHEAD} years ahead is allowed`,
  isDateWithinSupportedRange(`${thisYear + MAX_DATE_YEARS_AHEAD}-06-01`),
);
check(
  `${MAX_DATE_YEARS_AHEAD + 1} years ahead is not`,
  !isDateWithinSupportedRange(`${thisYear + MAX_DATE_YEARS_AHEAD + 1}-06-01`),
);
check("an old but real claim date still passes", isDateWithinSupportedRange("2019-03-04"));

console.log("\n=== both shared schemas enforce it ===");

check("dateStringSchema refuses 0206-10-02", !dateStringSchema.safeParse("0206-10-02").success);
check("dateSchema refuses 0206-10-02", !dateSchema.safeParse("0206-10-02").success);
check("dateStringSchema accepts today", dateStringSchema.safeParse(isoIn(0)).success);
check(
  "dateSchema still returns a UTC-midnight Date",
  dateSchema.safeParse("2026-10-23").success &&
    dateSchema.parse("2026-10-23").toISOString() === "2026-10-23T00:00:00.000Z",
);
check(
  "the calendar check still runs first",
  !dateStringSchema.safeParse("2026-02-30").success,
  "Feb 30 must stay refused",
);

console.log("\n=== follow-up dates ===");

check("yesterday is in the past", isFollowUpInPast(isoIn(-1)));
check("today is not in the past", !isFollowUpInPast(isoIn(0)));
check(`${FOLLOW_UP_CONFIRM_DAYS} days out is not 'far out'`, !isFollowUpFarOut(isoIn(FOLLOW_UP_CONFIRM_DAYS)));
check(`${FOLLOW_UP_CONFIRM_DAYS + 1} days out is`, isFollowUpFarOut(isoIn(FOLLOW_UP_CONFIRM_DAYS + 1)));

const note = (followUpDateSet?: string, followUpConfirmed?: boolean) =>
  createWorkNoteSchema.safeParse({
    claimId: "claim-1",
    outcomeType: "PAID",
    structuredFields: {},
    statusChangedTo: "Paid & Posted",
    ...(followUpDateSet ? { followUpDateSet } : {}),
    ...(followUpConfirmed === undefined ? {} : { followUpConfirmed }),
  });

check("a note with no follow-up date is fine", note().success);
check("a note with today's date is fine", note(isoIn(0)).success);
check("a note with yesterday's date is refused", !note(isoIn(-1)).success);
check("a note dated a year back is refused", !note(isoIn(-365)).success);
check(
  `${FOLLOW_UP_CONFIRM_DAYS + 30} days out is refused unconfirmed`,
  !note(isoIn(FOLLOW_UP_CONFIRM_DAYS + 30)).success,
);
check(
  "…and allowed once confirmed",
  note(isoIn(FOLLOW_UP_CONFIRM_DAYS + 30), true).success,
);
check(
  "confirmation does not excuse a past date",
  !note(isoIn(-1), true).success,
  "the two rules are independent",
);

const bulk = (followUpDate: string, followUpConfirmed?: boolean) =>
  bulkFollowUpSchema.safeParse({
    claimIds: ["claim-1", "claim-2"],
    followUpDate,
    ...(followUpConfirmed === undefined ? {} : { followUpConfirmed }),
  });

check("bulk: today is fine", bulk(isoIn(1)).success);
check("bulk: yesterday is refused", !bulk(isoIn(-1)).success);
check(
  "bulk: far out needs confirmation",
  !bulk(isoIn(FOLLOW_UP_CONFIRM_DAYS + 1)).success &&
    bulk(isoIn(FOLLOW_UP_CONFIRM_DAYS + 1), true).success,
);
check(
  "bulk: a mistyped year is caught by the shared bound",
  !bulk("0206-10-02").success,
);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
