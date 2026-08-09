/**
 * Recurring task generation and per-date schedule overrides.
 *
 *   npx tsx scripts/test-recurrence.ts
 *
 * Creates ZZ-prefixed rows and removes them at the end. It never touches
 * real data.
 */

import { PrismaClient, TaskStatus } from "../lib/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { config } from "dotenv";
import {
  describeRecurrence,
  isWeekend,
  nextBusinessDay,
  nextOccurrence,
  parseRecurringConfig,
  toIsoDate,
  toUtcDate,
  upcomingOccurrences,
} from "../lib/task/recurrence-config";

config({ path: ".env.local" });

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

let pass = 0;
let fail = 0;

function check(label: string, ok: boolean, detail = "") {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

/* ------------------------- pure date arithmetic ------------------------- */

console.log("=== recurrence dates ===");
{
  // 2026-07-30 is a Thursday.
  const thursday = toUtcDate("2026-07-30");

  const daily = { frequency: "daily" as const, nextDueDate: "2026-07-30" };
  check(
    "daily steps one day",
    toIsoDate(nextOccurrence(daily, thursday)!) === "2026-07-31",
    toIsoDate(nextOccurrence(daily, thursday)!),
  );

  /**
   * "Daily" means every business day. A queue that fills up over a weekend
   * nobody worked is two tasks that were never going to be done.
   */
  const friday = toUtcDate("2026-07-31");
  const saturday = toUtcDate("2026-08-01");
  const sunday = toUtcDate("2026-08-02");

  check(
    "daily jumps Friday to Monday",
    toIsoDate(nextOccurrence(daily, friday)!) === "2026-08-03",
    toIsoDate(nextOccurrence(daily, friday)!),
  );
  check(
    "from a Saturday it still lands on Monday",
    toIsoDate(nextOccurrence(daily, saturday)!) === "2026-08-03",
    toIsoDate(nextOccurrence(daily, saturday)!),
  );
  check(
    "and from a Sunday",
    toIsoDate(nextOccurrence(daily, sunday)!) === "2026-08-03",
    toIsoDate(nextOccurrence(daily, sunday)!),
  );
  check("Saturday is a weekend", isWeekend(saturday));
  check("Sunday is a weekend", isWeekend(sunday));
  check("Friday is not", !isWeekend(friday));

  // A series set up over a weekend starts on the Monday rather than dropping
  // its first occurrence onto a day nobody works.
  const weekendStart = { frequency: "daily" as const, nextDueDate: "2026-08-01" };
  const firstFew = upcomingOccurrences(weekendStart, 3).map(toIsoDate);
  check(
    "a daily series starting on a Saturday begins on Monday",
    JSON.stringify(firstFew) ===
      JSON.stringify(["2026-08-03", "2026-08-04", "2026-08-05"]),
    firstFew.join(", "),
  );

  const weekdays = {
    frequency: "weekly" as const,
    daysOfWeek: [1, 2, 3, 4, 5],
    nextDueDate: "2026-07-30",
  };
  check(
    "weekly Thu -> Fri",
    toIsoDate(nextOccurrence(weekdays, thursday)!) === "2026-07-31",
    toIsoDate(nextOccurrence(weekdays, thursday)!),
  );

  check(
    "weekly Fri wraps to Mon",
    toIsoDate(nextOccurrence(weekdays, friday)!) === "2026-08-03",
    toIsoDate(nextOccurrence(weekdays, friday)!),
  );

  const biweekly = { ...weekdays, frequency: "biweekly" as const };
  check(
    "bi-weekly Fri skips a week",
    toIsoDate(nextOccurrence(biweekly, friday)!) === "2026-08-10",
    toIsoDate(nextOccurrence(biweekly, friday)!),
  );

  const monthly = {
    frequency: "monthly" as const,
    dayOfMonth: 15,
    nextDueDate: "2026-07-15",
  };
  check(
    "monthly steps a month",
    toIsoDate(nextOccurrence(monthly, toUtcDate("2026-07-15"))!) ===
      "2026-08-15",
    toIsoDate(nextOccurrence(monthly, toUtcDate("2026-07-15"))!),
  );

  const ending = { ...daily, endDate: "2026-07-30" };
  check("end date stops the series", nextOccurrence(ending, thursday) === null);

  const three = upcomingOccurrences(weekdays, 3).map(toIsoDate);
  check(
    "three weekday occurrences",
    JSON.stringify(three) ===
      JSON.stringify(["2026-07-30", "2026-07-31", "2026-08-03"]),
    three.join(", "),
  );

  check(
    "describes a weekday pattern",
    describeRecurrence(weekdays) === "Weekly on Mon, Tue, Wed, Thu, Fri",
    describeRecurrence(weekdays),
  );

  check("malformed config parses to null", parseRecurringConfig({ x: 1 }) === null);
  check("null config parses to null", parseRecurringConfig(null) === null);
}

/* ------------------------- generation against the DB -------------------- */

async function main() {
  const owner = await prisma.user.findFirst({ where: { role: "OWNER" } });
  if (!owner) throw new Error("no owner user to attribute test rows to");

  const {
    createNextInstance,
    generateDueInstances,
    generateFirstInstance,
    closeSeries,
  } = await import("../lib/task/recurrence");

  console.log("\n=== series generation ===");

  // Dates are relative to today, because "due" is now the whole point.
  const now = new Date();
  const todayUtc = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const shift = (days: number) => {
    const date = new Date(todayUtc.getTime());
    date.setUTCDate(date.getUTCDate() + days);
    return toIsoDate(date);
  };

  const today = toIsoDate(todayUtc);

  /**
   * Daily now means weekdays only, so these dates are derived rather than
   * assumed — the suite has to pass whichever day of the week it runs on.
   *
   * The series is anchored on the last business day **on or before** today,
   * not the next one: an occurrence has to be due for the sweep to create it,
   * and on a Sunday the next business day is still in the future.
   */
  const previousBusinessDay = (from: Date): Date => {
    const back = new Date(from.getTime());
    do {
      back.setUTCDate(back.getUTCDate() - 1);
    } while (isWeekend(back));
    return back;
  };

  const firstDueDate = isWeekend(todayUtc)
    ? previousBusinessDay(todayUtc)
    : todayUtc;

  const firstDue = toIsoDate(firstDueDate);
  const afterFirst = toIsoDate(nextBusinessDay(firstDueDate));
  const beforeFirst = toIsoDate(previousBusinessDay(firstDueDate));

  const mark = async (id: string) =>
    parseRecurringConfig(
      (await prisma.task.findUnique({ where: { id } }))!.recurringConfig,
    )?.nextDueDate ?? "none";

  const reload = async (id: string) =>
    (await prisma.task.findUnique({ where: { id } }))!;

  /**
   * The sweep is deliberately not scoped to one series, so the test series are
   * assigned to a throwaway user. Sweeping by the owner would generate real
   * occurrences on whatever real series they happen to own.
   */
  const assignee = await prisma.user.create({
    data: {
      name: "ZZ Recurrence Assignee",
      email: `zz-recurrence-${Date.now()}@example.test`,
      hashedPassword: "not-a-real-hash",
    },
  });

  const parent = await prisma.task.create({
    data: {
      title: "ZZ Recurring parent",
      createdById: owner.id,
      assignedToId: assignee.id,
      isRecurring: true,
      recurringConfig: { frequency: "daily", nextDueDate: firstDue },
    },
  });

  const first = await generateFirstInstance(parent);
  check("creating a series makes one instance", first !== null);
  check("it is numbered 1", first?.instanceNumber === 1, String(first?.instanceNumber));
  check(
    "it is dated the first business day of the series",
    first?.dueDate !== null && first?.dueDate !== undefined &&
      toIsoDate(first.dueDate) === firstDue,
    first?.dueDate ? toIsoDate(first.dueDate) : "none",
  );
  check("it inherits the assignee", first?.assignedToId === assignee.id);
  check("it is not itself recurring", first?.isRecurring === false);

  const onlyOne = await prisma.task.count({ where: { parentTaskId: parent.id } });
  check("nothing else was generated up front", onlyOne === 1, String(onlyOne));

  check(
    "the mark moved to the next business day",
    (await mark(parent.id)) === afterFirst,
    await mark(parent.id),
  );

  console.log("\n=== an occurrence is not created before it is due ===");

  const early = await createNextInstance(await reload(parent.id));
  check("closing today's does not create the next one", early === null);
  check(
    "and the mark stays where it was",
    (await mark(parent.id)) === afterFirst,
    await mark(parent.id),
  );

  const stillOne = await prisma.task.count({ where: { parentTaskId: parent.id } });
  check("still one instance", stillOne === 1, String(stillOne));

  console.log("\n=== the sweep creates what has come due ===");

  const untouched = await generateDueInstances({ assignedToId: assignee.id });
  check(
    "a series marked for the future generates nothing",
    untouched.created === 0,
    String(untouched.created),
  );

  // Wind the mark back one business day, so it and the first are both due.
  await prisma.task.update({
    where: { id: parent.id },
    data: { recurringConfig: { frequency: "daily", nextDueDate: beforeFirst } },
  });

  const swept = await generateDueInstances({ assignedToId: assignee.id });
  check("the missed day is created", swept.created === 1, String(swept.created));
  check("one series produced it", swept.series === 1, String(swept.series));
  check(
    "today's was left alone as it already exists",
    (await prisma.task.count({ where: { parentTaskId: parent.id } })) === 2,
    String(await prisma.task.count({ where: { parentTaskId: parent.id } })),
  );
  check(
    "the mark ends up past the first occurrence",
    (await mark(parent.id)) === afterFirst,
    await mark(parent.id),
  );

  console.log("\n=== a long backlog is fast-forwarded, not backfilled ===");

  const dormant = await prisma.task.create({
    data: {
      title: "ZZ Recurring dormant",
      createdById: owner.id,
      assignedToId: assignee.id,
      isRecurring: true,
      recurringConfig: { frequency: "daily", nextDueDate: shift(-30) },
    },
  });

  const caught = await generateDueInstances({ assignedToId: assignee.id });
  const dormantCount = await prisma.task.count({
    where: { parentTaskId: dormant.id },
  });
  check(
    "at most a week of catch-up is created",
    dormantCount === 7,
    String(dormantCount),
  );
  check("the sweep reports what it wrote", caught.created === 7, String(caught.created));
  check(
    "the newest catch-up instance is the current one",
    (await prisma.task.findFirst({
      where: { parentTaskId: dormant.id },
      orderBy: { dueDate: "desc" },
      select: { dueDate: true },
    }))!.dueDate!.toISOString().slice(0, 10) === firstDue,
  );
  check(
    "no catch-up instance landed on a weekend",
    (
      await prisma.task.findMany({
        where: { parentTaskId: dormant.id },
        select: { dueDate: true },
      })
    ).every((task) => task.dueDate !== null && !isWeekend(task.dueDate)),
  );
  check(
    "and the mark is back on schedule",
    (await mark(dormant.id)) === afterFirst,
    await mark(dormant.id),
  );

  console.log("\n=== a date already scheduled is never doubled ===");

  await prisma.task.update({
    where: { id: parent.id },
    data: { recurringConfig: { frequency: "daily", nextDueDate: firstDue } },
  });

  const duplicate = await createNextInstance(await reload(parent.id));
  check("a clashing date creates nothing", duplicate === null);
  check(
    "but the series still advances past it",
    (await mark(parent.id)) === afterFirst,
    await mark(parent.id),
  );

  console.log("\n=== closing the parent closes the series ===");

  // Two: today's and the one the sweep created for the missed day. A series
  // no longer carries a stack of future occurrences to close.
  const closed = await closeSeries(parent.id, owner.id);
  check("pending instances were closed", closed === 2, String(closed));

  const stillOpen = await prisma.task.count({
    where: { parentTaskId: parent.id, status: { not: TaskStatus.CLOSED } },
  });
  check("nothing is left open", stillOpen === 0, String(stillOpen));

  const noteCount = await prisma.taskNote.count({
    where: { task: { parentTaskId: parent.id } },
  });
  check("each closure was logged", noteCount === closed, String(noteCount));

  console.log("\n=== task types ===");

  const types = await prisma.taskType.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
  });

  check("nine default types are seeded", types.length >= 9, String(types.length));
  // Order is owner-editable at /settings/task-types, so asserting which
  // type comes first would fail the moment someone reorders the list. What
  // must hold is that the nine defaults are all present.
  const names = new Set(types.map((type) => type.name));
  const missing = [
    "Charge Posting",
    "Payment Posting",
    "Denial/Rejection Work",
    "Claim Follow-up",
    "Authorization",
    "Eligibility Check",
    "Report",
    "Patient Inquiry",
    "Clinic Inquiry",
  ].filter((name) => !names.has(name));

  check(
    "every default type is present",
    missing.length === 0,
    missing.join(", ") || "none missing",
  );
  check(
    "types come back in sortOrder",
    types.every((type, i) => i === 0 || types[i - 1]!.sortOrder <= type.sortOrder),
  );

  // Cleanup — notes first, then children, then the parents they hang off.
  await prisma.taskNote.deleteMany({
    where: {
      task: {
        OR: [
          { title: { startsWith: "ZZ " } },
          { parentTask: { title: { startsWith: "ZZ " } } },
        ],
      },
    },
  });
  await prisma.task.deleteMany({
    where: { parentTask: { title: { startsWith: "ZZ " } } },
  });
  await prisma.task.deleteMany({ where: { title: { startsWith: "ZZ " } } });
  await prisma.user.delete({ where: { id: assignee.id } });

  const leftover = await prisma.task.count({
    where: { title: { startsWith: "ZZ " } },
  });
  check("test rows cleaned up", leftover === 0, String(leftover));
}

main()
  .catch((error) => {
    console.error(error);
    fail++;
  })
  .finally(async () => {
    await prisma.$disconnect();
    console.log(`\n${"=".repeat(60)}`);
    console.log(fail > 0 ? `PASSED ${pass}   FAILED ${fail}` : `ALL ${pass} CHECKS PASSED`);
    console.log("=".repeat(60));
    process.exit(fail === 0 ? 0 : 1);
  });
