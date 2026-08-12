/**
 * AR daily hours: a rate over a range, not a deadline.
 *
 *   npx tsx scripts/test-daily-hours.ts
 *
 * The five cases that decide whether the planner tells the truth:
 *
 *  1. one AR project spreads its rate across the working days of its range;
 *  2. two **sequential** projects do not overlap;
 *  3. two **simultaneous** projects add up on each day;
 *  4. an AR project with no daily hours falls back to its due date and is
 *     reported as unconfigured — it used to be counted nowhere at all, which
 *     made a fully committed biller look free;
 *  5. a non-AR task still lands on its due date alone.
 *
 * Creates ZZ-prefixed rows and removes them at the end. It never touches real
 * data.
 */

import { PrismaClient } from "../lib/generated/prisma/client";
import { EhrSource, Role, TaskStatus } from "../lib/generated/prisma/enums";
import { PrismaPg } from "@prisma/adapter-pg";
import { config } from "dotenv";

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

const STAMP = Date.now();

/**
 * The window is anchored in the future so every day is "today or later" — the
 * planner reports past days from the timer, and a fixture in the past would be
 * testing the wrong half.
 */
const base = new Date();
const day = (offset: number) => {
  const date = new Date(
    Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()),
  );
  date.setUTCDate(date.getUTCDate() + offset);
  return date;
};

const iso = (date: Date) => date.toISOString().slice(0, 10);

async function main() {
  const { spreadDays, workingDaysBetween } = await import(
    "../lib/task/daily-hours"
  );
  const { getWorkloadData } = await import("../lib/analytics/workload");

  console.log("=== spreading, without the database ===");

  // A Monday, so the weekend positions are predictable.
  const monday = new Date("2026-03-02T00:00:00.000Z");
  const friday = new Date("2026-03-06T00:00:00.000Z");
  const nextFriday = new Date("2026-03-13T00:00:00.000Z");

  const oneWeek = spreadDays(
    { startDate: monday, dueDate: friday, createdAt: monday, dailyHours: 2 },
    monday,
    nextFriday,
  );

  check(
    "a Monday-to-Friday range is five working days",
    oneWeek.length === 5,
    oneWeek.join(", "),
  );

  const twoWeeks = spreadDays(
    {
      startDate: monday,
      dueDate: nextFriday,
      createdAt: monday,
      dailyHours: 2,
    },
    monday,
    nextFriday,
  );

  check(
    "a fortnight is ten working days — the weekend is skipped",
    twoWeeks.length === 10,
    String(twoWeeks.length),
  );
  check(
    "no Saturday or Sunday is in the spread",
    twoWeeks.every((date) => {
      const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
      return weekday !== 0 && weekday !== 6;
    }),
  );

  check(
    "the spread is clipped to the window, not the task",
    spreadDays(
      {
        startDate: monday,
        dueDate: nextFriday,
        createdAt: monday,
        dailyHours: 2,
      },
      monday,
      friday,
    ).length === 5,
  );

  check(
    "a task with no due date spreads nowhere",
    spreadDays(
      { startDate: monday, dueDate: null, createdAt: monday, dailyHours: 2 },
      monday,
      nextFriday,
    ).length === 0,
  );

  check(
    "an unset start falls back to when the task was created",
    spreadDays(
      { startDate: null, dueDate: friday, createdAt: monday, dailyHours: 2 },
      monday,
      nextFriday,
    ).length === 5,
  );

  check(
    "working days between a Monday and the Friday after next",
    workingDaysBetween(monday, nextFriday) === 10,
    String(workingDaysBetween(monday, nextFriday)),
  );

  // ---------------------------------------------------------------- fixtures

  const owner = await prisma.user.findFirst({
    where: { role: Role.OWNER, isActive: true },
    orderBy: { createdAt: "asc" },
  });
  if (!owner) throw new Error("no owner user to hang the fixtures on");

  const biller = await prisma.user.create({
    data: {
      name: "ZZ DailyHours Biller",
      email: `zz-dailyhours-${STAMP}@example.test`,
      hashedPassword: "not-a-real-hash",
      role: Role.BILLER,
    },
  });

  const [practiceA, practiceB] = await Promise.all([
    prisma.practice.create({
      data: {
        name: `ZZ DailyHours A ${STAMP}`,
        ehrSource: EhrSource.OPEN_PM,
      },
    }),
    prisma.practice.create({
      data: {
        name: `ZZ DailyHours B ${STAMP}`,
        ehrSource: EhrSource.OPEN_PM,
      },
    }),
  ]);

  await prisma.userPractice.createMany({
    data: [
      { userId: biller.id, practiceId: practiceA.id },
      { userId: biller.id, practiceId: practiceB.id },
    ],
  });

  const followUpType = await prisma.taskType.upsert({
    where: { name: "Claim Follow-up" },
    update: {},
    create: { name: "Claim Follow-up", sortOrder: 900 },
  });

  const reportType = await prisma.taskType.upsert({
    where: { name: "Report" },
    update: {},
    create: { name: "Report", sortOrder: 902 },
  });

  const makeTask = (opts: {
    label: string;
    taskTypeId: string;
    practiceId: string;
    startDate?: Date | null;
    dueDate: Date;
    dailyHours?: string | null;
    estimatedMinutes?: number | null;
  }) =>
    prisma.task.create({
      data: {
        title: `ZZ DailyHours ${opts.label}`,
        taskTypeId: opts.taskTypeId,
        practiceId: opts.practiceId,
        createdById: owner.id,
        assignedToId: biller.id,
        status: TaskStatus.OPEN,
        startDate: opts.startDate ?? null,
        dueDate: opts.dueDate,
        dailyHours: opts.dailyHours ?? null,
        estimatedMinutes: opts.estimatedMinutes ?? null,
      },
    });

  /** The planner over the next four weeks, for this one biller. */
  const planner = () =>
    getWorkloadData({
      from: day(0),
      to: day(27),
      userIds: [biller.id],
      targetHoursPerDay: 8,
      viewerPracticeIds: [practiceA.id],
    });

  const minutesOn = (
    result: Awaited<ReturnType<typeof planner>>,
    offset: number,
  ) =>
    result.billers[0]?.days.find((entry) => entry.date === iso(day(offset)))
      ?.arMinutes ?? 0;

  console.log("\n=== 1. one AR project spreads across its range ===");

  const first = await makeTask({
    label: "single",
    taskTypeId: followUpType.id,
    practiceId: practiceA.id,
    startDate: day(0),
    dueDate: day(6),
    dailyHours: "2.00",
  });

  let result = await planner();
  let days = result.billers[0]!.days;

  const inRange = days.filter(
    (entry) =>
      entry.date >= iso(day(0)) &&
      entry.date <= iso(day(6)) &&
      !entry.isWeekend,
  );

  check(
    "every working day in the range carries the daily rate",
    inRange.length > 0 && inRange.every((entry) => entry.arMinutes === 120),
    inRange.map((entry) => `${entry.date}:${entry.arMinutes}`).join(" "),
  );
  check(
    "weekends inside the range carry nothing",
    days
      .filter((entry) => entry.isWeekend && entry.date <= iso(day(6)))
      .every((entry) => entry.arMinutes === 0),
  );
  check(
    "a day past the due date carries nothing",
    minutesOn(result, 10) === 0,
    String(minutesOn(result, 10)),
  );

  console.log("\n=== 2. two sequential projects do not overlap ===");

  const second = await makeTask({
    label: "sequential",
    taskTypeId: followUpType.id,
    practiceId: practiceB.id,
    startDate: day(7),
    dueDate: day(13),
    dailyHours: "3.00",
  });

  result = await planner();

  const firstHalf = result.billers[0]!.days.filter(
    (entry) => !entry.isWeekend && entry.date <= iso(day(6)),
  );
  const secondHalf = result.billers[0]!.days.filter(
    (entry) =>
      !entry.isWeekend &&
      entry.date >= iso(day(7)) &&
      entry.date <= iso(day(13)),
  );

  check(
    "the first week carries only the first project's 2h",
    firstHalf.every((entry) => entry.arMinutes === 120),
    firstHalf.map((entry) => entry.arMinutes).join(","),
  );
  check(
    "the second week carries only the second project's 3h",
    secondHalf.every((entry) => entry.arMinutes === 180),
    secondHalf.map((entry) => entry.arMinutes).join(","),
  );

  console.log("\n=== 3. two simultaneous projects add up ===");

  const overlapping = await makeTask({
    label: "simultaneous",
    taskTypeId: followUpType.id,
    practiceId: practiceB.id,
    startDate: day(0),
    dueDate: day(6),
    dailyHours: "1.00",
  });

  result = await planner();

  const overlapDays = result.billers[0]!.days.filter(
    (entry) => !entry.isWeekend && entry.date <= iso(day(6)),
  );

  check(
    "2h/day and 1h/day on the same days come to 3h",
    overlapDays.every((entry) => entry.arMinutes === 180),
    overlapDays.map((entry) => entry.arMinutes).join(","),
  );
  check(
    "both practices are listed separately on the day",
    (result.billers[0]!.days.find(
      (entry) => !entry.isWeekend && entry.date <= iso(day(6)),
    )?.items.filter((item) => item.kind === "ar").length ?? 0) === 2,
  );

  console.log("\n=== multi-PM visibility ===");

  const arItems =
    result.billers[0]!.days
      .find((entry) => !entry.isWeekend && entry.date <= iso(day(6)))
      ?.items.filter((item) => item.kind === "ar") ?? [];

  check(
    "the viewer's own practice is not marked as another PM's",
    arItems.some(
      (item) => item.practiceName?.includes("DailyHours A") && !item.isOtherPm,
    ),
  );
  check(
    "a practice the viewer does not manage is marked, and still counted",
    arItems.some(
      (item) => item.practiceName?.includes("DailyHours B") && item.isOtherPm,
    ),
    "the hours consume the day either way — that is the point",
  );
  check(
    "the other PM's block says so in its label",
    arItems.some((item) => item.label.includes("(other PM)")),
    arItems.map((item) => item.label).join(" | "),
  );

  console.log(
    "\n=== 4. an unconfigured AR task falls back to its due date ===",
  );

  await prisma.task.update({
    where: { id: overlapping.id },
    data: { dailyHours: null, estimatedMinutes: 300 },
  });

  result = await planner();

  const afterClearing = result.billers[0]!.days.filter(
    (entry) => !entry.isWeekend && entry.date <= iso(day(6)),
  );

  check(
    "its daily rate leaves the AR bucket",
    afterClearing.every((entry) => entry.arMinutes === 120),
    afterClearing.map((entry) => entry.arMinutes).join(","),
  );

  const dueDayCell = result.billers[0]!.days.find(
    (entry) => entry.date === iso(day(6)),
  );

  check(
    "but the whole estimate lands on the due date rather than vanishing",
    dueDayCell?.arUnconfiguredMinutes === 300,
    `${dueDayCell?.arUnconfiguredMinutes} min on ${iso(day(6))}`,
  );
  check(
    "and it counts towards that day's total",
    (dueDayCell?.totalMinutes ?? 0) >= 300,
    `${dueDayCell?.totalMinutes} total`,
  );
  check(
    "carrying its own kind, so the cell can flag it",
    dueDayCell?.items.some((item) => item.kind === "ar-unconfigured") === true,
  );
  check(
    "no other day picks it up",
    result.billers[0]!.days
      .filter((entry) => entry.date !== iso(day(6)))
      .every((entry) => entry.arUnconfiguredMinutes === 0),
  );
  check(
    "and it is still reported as unconfigured",
    result.billers[0]!.unconfiguredAr.length === 1,
    String(result.billers[0]!.unconfiguredAr.length),
  );
  check(
    "the summary counts it too",
    result.summary.unconfiguredArTasks === 1,
    String(result.summary.unconfiguredArTasks),
  );
  check(
    "an unconfigured task on another PM's practice cannot be configured here",
    result.billers[0]!.unconfiguredAr[0]?.canConfigure === false,
  );

  console.log("\n=== free hours ===");

  const workingDay = result.billers[0]!.days.find(
    (entry) => !entry.isWeekend && entry.date <= iso(day(4)),
  )!;

  check(
    "free minutes are the target less everything committed",
    workingDay.freeMinutes ===
      Math.max(0, result.targetMinutesPerDay - workingDay.totalMinutes),
    `${workingDay.freeMinutes} = ${result.targetMinutesPerDay} - ${workingDay.totalMinutes}`,
  );
  check(
    "free hours are the same figure, in hours",
    workingDay.freeHours === Math.round((workingDay.freeMinutes / 60) * 10) / 10,
    String(workingDay.freeHours),
  );
  check(
    "a day with 2h of AR against a 8h target has 6h free",
    workingDay.freeHours === 6,
    `${workingDay.freeHours}h free of ${result.targetMinutesPerDay / 60}h`,
  );

  const weekendDay = result.billers[0]!.days.find((entry) => entry.isWeekend)!;

  check(
    "a weekend has no free capacity to offer",
    weekendDay.freeMinutes === 0,
    "no target, so no spare",
  );

  // Deliberately more than a whole day, on a day known to be a weekday.
  const overCommitted = await makeTask({
    label: "overload",
    taskTypeId: reportType.id,
    practiceId: practiceA.id,
    dueDate: new Date(`${workingDay.date}T00:00:00.000Z`),
    estimatedMinutes: 900,
  });

  result = await planner();

  const stuffed = result.billers[0]!.days.find(
    (entry) => entry.date === workingDay.date,
  );

  check(
    "an over-capacity day reports no free time rather than a negative",
    stuffed?.freeMinutes === 0 && (stuffed?.totalMinutes ?? 0) > 480,
    `${stuffed?.totalMinutes} min committed against ${result.targetMinutesPerDay}`,
  );

  await prisma.task.delete({ where: { id: overCommitted.id } });

  console.log("\n=== 5. a non-AR task still lands on its due date ===");

  await makeTask({
    label: "report",
    taskTypeId: reportType.id,
    practiceId: practiceA.id,
    dueDate: day(3),
    estimatedMinutes: 90,
  });

  result = await planner();

  const dueDay = result.billers[0]!.days.find(
    (entry) => entry.date === iso(day(3)),
  );

  check(
    "its estimate is on the due date",
    (dueDay?.totalMinutes ?? 0) - (dueDay?.arMinutes ?? 0) === 90,
    `${dueDay?.totalMinutes} total, ${dueDay?.arMinutes} of it AR`,
  );
  check(
    "and nowhere else",
    // By kind rather than by total: the day also carries AR, and another day
    // now carries an unconfigured AR fallback, so a bare total proves nothing.
    result.billers[0]!.days
      .filter((entry) => entry.date !== iso(day(3)))
      .every((entry) => entry.actualMinutes === 0),
  );

  // Cleanup. Tasks first, then the practices they hang off.
  await prisma.task.deleteMany({
    where: { title: { startsWith: "ZZ DailyHours" } },
  });
  await prisma.practice.deleteMany({
    where: { id: { in: [practiceA.id, practiceB.id] } },
  });
  await prisma.user.delete({ where: { id: biller.id } });

  const leftover = await prisma.task.count({
    where: { title: { startsWith: "ZZ DailyHours" } },
  });
  check("test rows cleaned up", leftover === 0, String(leftover));

  void first;
  void second;
}

main()
  .catch((error) => {
    console.error(error);
    fail++;
  })
  .finally(async () => {
    await prisma.$disconnect();
    console.log(`\n${"=".repeat(60)}`);
    console.log(
      fail > 0 ? `PASSED ${pass}   FAILED ${fail}` : `ALL ${pass} CHECKS PASSED`,
    );
    console.log("=".repeat(60));
    process.exit(fail === 0 ? 0 : 1);
  });
