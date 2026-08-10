/**
 * The workload projection engine.
 *
 *   npx tsx scripts/test-projection.ts
 *
 * Projections are what the planner shows for days that have not happened, so
 * a wrong one is a staffing decision made on a fiction. Every frequency is
 * walked over a fixed window, against ZZ-prefixed series removed at the end.
 */

import { PrismaClient } from "../lib/generated/prisma/client";
import { EhrSource, TaskStatus } from "../lib/generated/prisma/enums";
import { PrismaPg } from "@prisma/adapter-pg";
import { config } from "dotenv";
import { toIsoDate, toUtcDate } from "../lib/task/recurrence-config";

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

/**
 * A fixed fortnight, so the expected dates can be written down.
 * 2026-09-07 is a Monday; 2026-09-20 is the Sunday two weeks on.
 */
const FROM = toUtcDate("2026-09-07");
const TO = toUtcDate("2026-09-20");

const stamp = Date.now();

async function main() {
  const { projectRecurringTasks } = await import(
    "../lib/task/workload-projection"
  );

  const owner = await prisma.user.findFirst({ where: { role: "OWNER" } });
  if (!owner) throw new Error("no owner user to attribute test rows to");

  /* ------------------------------ fixtures ------------------------------ */

  const practice = await prisma.practice.create({
    data: { name: "ZZ Projection Practice", ehrSource: EhrSource.OPEN_PM },
  });

  const assignee = await prisma.user.create({
    data: {
      name: "ZZ Projection Biller",
      email: `zz-projection-${stamp}@example.test`,
      hashedPassword: "not-a-real-hash",
    },
  });

  const taskType = await prisma.taskType.create({
    data: { name: "ZZ Projection Type", sortOrder: 9999 },
  });

  const series = (title: string, recurringConfig: object, minutes = 30) =>
    prisma.task.create({
      data: {
        title,
        createdById: owner.id,
        assignedToId: assignee.id,
        practiceId: practice.id,
        taskTypeId: taskType.id,
        estimatedMinutes: minutes,
        isRecurring: true,
        recurringConfig,
      },
    });

  /** Only this test's series, by date. */
  const datesFor = async (parentId: string) =>
    (await projectRecurringTasks(FROM, TO, { userIds: [assignee.id] }))
      .filter((task) => task.parentTaskId === parentId)
      .map((task) => toIsoDate(task.dueDate));

  console.log("=== daily: business days only ===");
  {
    const daily = await series("ZZ Proj daily", {
      frequency: "daily",
      nextDueDate: "2026-09-07",
    });

    const dates = await datesFor(daily.id);

    // Ten weekdays across the fortnight; the two weekends are skipped.
    check(
      "ten weekdays, no weekend",
      dates.join(",") ===
        [
          "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11",
          "2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18",
        ].join(","),
      dates.join(", "),
    );
  }

  console.log("\n=== weekly: only the named days ===");
  {
    const weekly = await series("ZZ Proj weekly", {
      frequency: "weekly",
      daysOfWeek: [2, 4], // Tuesday and Thursday
      nextDueDate: "2026-09-08",
    });

    const dates = await datesFor(weekly.id);

    check(
      "four occurrences, Tuesdays and Thursdays",
      dates.join(",") ===
        ["2026-09-08", "2026-09-10", "2026-09-15", "2026-09-17"].join(","),
      dates.join(", "),
    );
  }

  console.log("\n=== bi-weekly: every other week ===");
  {
    const biweekly = await series("ZZ Proj biweekly", {
      frequency: "biweekly",
      daysOfWeek: [1], // Mondays
      nextDueDate: "2026-09-07",
    });

    const dates = await datesFor(biweekly.id);

    // The 14th is skipped: bi-weekly crosses into the next week and then
    // waits one out.
    check(
      "the second Monday is skipped",
      dates.join(",") === ["2026-09-07"].join(","),
      dates.join(", "),
    );
  }

  console.log("\n=== monthly: the named date ===");
  {
    const monthly = await series("ZZ Proj monthly", {
      frequency: "monthly",
      dayOfMonth: 15,
      nextDueDate: "2026-09-15",
    });

    const dates = await datesFor(monthly.id);

    check(
      "one occurrence in the window",
      dates.join(",") === "2026-09-15",
      dates.join(", "),
    );
  }

  console.log("\n=== an occurrence already generated is not projected ===");
  {
    const daily = await series("ZZ Proj skip", {
      frequency: "daily",
      nextDueDate: "2026-09-07",
    });

    const before = await datesFor(daily.id);

    // The sweep would have written this one for real.
    await prisma.task.create({
      data: {
        title: "ZZ Proj skip instance",
        createdById: owner.id,
        assignedToId: assignee.id,
        practiceId: practice.id,
        taskTypeId: taskType.id,
        dueDate: toUtcDate("2026-09-09"),
        parentTaskId: daily.id,
        instanceNumber: 1,
        status: TaskStatus.OPEN,
      },
    });

    const after = await datesFor(daily.id);

    check(
      "the real instance drops out of the projection",
      !after.includes("2026-09-09") && before.includes("2026-09-09"),
      after.join(", "),
    );
    check(
      "and nothing else moves",
      after.length === before.length - 1,
      `${before.length} → ${after.length}`,
    );
  }

  console.log("\n=== endDate stops the walk ===");
  {
    const ending = await series("ZZ Proj ending", {
      frequency: "daily",
      nextDueDate: "2026-09-07",
      endDate: "2026-09-09",
    });

    const dates = await datesFor(ending.id);

    check(
      "nothing past the end date",
      dates.join(",") === ["2026-09-07", "2026-09-08", "2026-09-09"].join(","),
      dates.join(", "),
    );
  }

  console.log("\n=== what a projection carries ===");
  {
    const rows = (
      await projectRecurringTasks(FROM, TO, { userIds: [assignee.id] })
    ).filter((task) => task.practiceId === practice.id);

    const first = rows[0];

    check("every row is marked projected", rows.every((row) => row.isProjected));
    check("the biller comes through", first?.billerName === "ZZ Projection Biller");
    check("the practice comes through", first?.practiceName === "ZZ Projection Practice");
    check("the task type comes through", first?.taskTypeName === "ZZ Projection Type");
    check("the estimate comes through", first?.estimatedMinutes === 30, String(first?.estimatedMinutes));
    check(
      "rows are in date order",
      rows.every(
        (row, index) =>
          index === 0 || rows[index - 1]!.dueDate <= row.dueDate,
      ),
    );
  }

  console.log("\n=== a closed series projects nothing ===");
  {
    const closed = await series("ZZ Proj closed", {
      frequency: "daily",
      nextDueDate: "2026-09-07",
    });

    await prisma.task.update({
      where: { id: closed.id },
      data: { status: TaskStatus.CLOSED },
    });

    check("no projections from it", (await datesFor(closed.id)).length === 0);
  }

  console.log("\n=== filters narrow the walk ===");
  {
    const other = await prisma.user.create({
      data: {
        name: "ZZ Projection Other",
        email: `zz-projection-other-${stamp}@example.test`,
        hashedPassword: "not-a-real-hash",
      },
    });

    const forOther = await prisma.task.create({
      data: {
        title: "ZZ Proj other biller",
        createdById: owner.id,
        assignedToId: other.id,
        practiceId: practice.id,
        estimatedMinutes: 30,
        isRecurring: true,
        recurringConfig: { frequency: "daily", nextDueDate: "2026-09-07" },
      },
    });

    const mine = await projectRecurringTasks(FROM, TO, {
      userIds: [assignee.id],
    });

    check(
      "another biller's series is excluded",
      mine.every((task) => task.parentTaskId !== forOther.id),
    );

    const byPractice = await projectRecurringTasks(FROM, TO, {
      practiceIds: ["no-such-practice"],
    });

    check("an unmatched practice projects nothing", byPractice.length === 0);

    await prisma.task.deleteMany({ where: { id: forOther.id } });
    await prisma.user.delete({ where: { id: other.id } });
  }

  /* ------------------------------ cleanup ------------------------------- */

  await prisma.taskNote.deleteMany({
    where: { task: { title: { startsWith: "ZZ Proj" } } },
  });
  await prisma.task.deleteMany({
    where: { parentTask: { title: { startsWith: "ZZ Proj" } } },
  });
  await prisma.task.deleteMany({ where: { title: { startsWith: "ZZ Proj" } } });
  await prisma.user.delete({ where: { id: assignee.id } });
  await prisma.taskType.delete({ where: { id: taskType.id } });
  await prisma.practice.delete({ where: { id: practice.id } });

  const leftover = await prisma.task.count({
    where: { title: { startsWith: "ZZ Proj" } },
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
