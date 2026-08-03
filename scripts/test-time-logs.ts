/**
 * Time log analysis: efficiency rate, overrun detection and the per-task
 * (not per-session) treatment of estimates.
 *
 *   npx tsx scripts/test-time-logs.ts
 *
 * Creates ZZ-prefixed rows in a window far in the past — real sessions cannot
 * land there — and removes them at the end.
 */

import { PrismaClient } from "../lib/generated/prisma/client";
import { EhrSource, TaskStatus } from "../lib/generated/prisma/enums";
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

/** A day nobody has ever logged time on. */
const DAY = "2019-03-14";
const at = (hour: number) => new Date(`${DAY}T${String(hour).padStart(2, "0")}:00:00.000Z`);

async function main() {
  // lib/time-analysis imports lib/prisma, which reads DATABASE_URL as it
  // loads — so it cannot be imported before config() has run.
  const { efficiencyRate, isOverrun, getTimeLogSummary } = await import(
    "../lib/time-analysis"
  );

  console.log("=== pure helpers ===");

  check("logged under estimate is under 100%", efficiencyRate(30, 60) === 50);
  check("logged at estimate is 100%", efficiencyRate(60, 60) === 100);
  check("logged over estimate is over 100%", efficiencyRate(90, 60) === 150);
  check("one decimal place", efficiencyRate(100, 60) === 166.7, String(efficiencyRate(100, 60)));
  check("no estimate has no rate", efficiencyRate(90, 0) === null);

  check("past the estimate is an overrun", isOverrun(61, 60));
  check("exactly on the estimate is not", !isOverrun(60, 60));
  check("under the estimate is not", !isOverrun(59, 60));
  check("a task with no estimate cannot overrun", !isOverrun(500, null));
  check("a zero estimate cannot overrun", !isOverrun(500, 0));

  console.log("\n=== summary over real rows ===");

  const owner = await prisma.user.findFirst({ where: { role: "OWNER" } });
  if (!owner) throw new Error("no owner user to attribute test rows to");

  const practice = await prisma.practice.create({
    data: { name: "ZZ Time Log Practice", ehrSource: EhrSource.OPEN_PM },
  });

  const type = await prisma.taskType.create({
    data: { name: "ZZ Time Log Type", sortOrder: 9999 },
  });

  const makeTask = (title: string, estimatedMinutes: number | null) =>
    prisma.task.create({
      data: {
        title,
        createdById: owner.id,
        assignedToId: owner.id,
        practiceId: practice.id,
        taskTypeId: type.id,
        estimatedMinutes,
      },
    });

  // 60 estimated, 80 logged across two sessions — over by 20 (33.3%).
  const over = await makeTask("ZZ TimeLog Over", 60);
  // 120 estimated, 60 logged in one session — comfortably inside.
  const under = await makeTask("ZZ TimeLog Under", 120);
  // No estimate at all: its 40 minutes count as time, but not as a budget.
  const unestimated = await makeTask("ZZ TimeLog Unestimated", null);

  const log = (taskId: string, startHour: number, minutes: number) =>
    prisma.taskTimeLog.create({
      data: {
        taskId,
        userId: owner.id,
        startedAt: at(startHour),
        stoppedAt: new Date(at(startHour).getTime() + minutes * 60_000),
        durationMinutes: minutes,
      },
    });

  await log(over.id, 9, 30);
  await log(over.id, 11, 50);
  await log(under.id, 13, 60);
  await log(unestimated.id, 15, 40);

  // A session still running has no duration and must be left out entirely.
  await prisma.taskTimeLog.create({
    data: { taskId: under.id, userId: owner.id, startedAt: at(17) },
  });

  await prisma.task.updateMany({
    where: { id: over.id },
    data: { totalLoggedMinutes: 80 },
  });

  const summary = await getTimeLogSummary({
    from: at(0),
    to: at(23),
    practiceIds: [practice.id],
  });

  check("only the stopped sessions count", summary.sessionCount === 4, String(summary.sessionCount));
  check(
    "logged is every session's duration",
    summary.totalLoggedMinutes === 180,
    String(summary.totalLoggedMinutes),
  );
  check(
    "estimates are counted once per task, not per session",
    summary.totalEstimatedMinutes === 180,
    String(summary.totalEstimatedMinutes),
  );
  check(
    "efficiency is logged over estimated",
    summary.efficiencyRate === 100,
    String(summary.efficiencyRate),
  );

  check("one task is over its estimate", summary.overrunTaskCount === 1, String(summary.overrunTaskCount));

  const overrun = summary.overrunTasks[0];
  check("the right task is flagged", overrun?.taskId === over.id);
  check("over-by is the difference", overrun?.overrunMinutes === 20, String(overrun?.overrunMinutes));
  check(
    "over-percent is against the estimate",
    overrun?.overrunPercent === 33.3,
    String(overrun?.overrunPercent),
  );
  check("the overrun carries its label", overrun?.taskLabel === "ZZ Time Log Type — ZZ Time Log Practice", overrun?.taskLabel);
  check("an open overrun reports its status", overrun?.status === TaskStatus.OPEN);

  console.log("\n=== breakdowns ===");

  const biller = summary.byBiller.find((entry) => entry.userId === owner.id);
  check("the biller's logged time matches", biller?.totalLoggedMinutes === 180, String(biller?.totalLoggedMinutes));
  check("the biller's session count matches", biller?.sessionCount === 4, String(biller?.sessionCount));
  check("the biller carries the overrun", biller?.overrunCount === 1, String(biller?.overrunCount));

  const billerType = biller?.byTaskType.find((entry) => entry.taskTypeName === "ZZ Time Log Type");
  check("the type breakdown counts distinct tasks", billerType?.taskCount === 3, String(billerType?.taskCount));

  const byType = summary.byTaskType.find((entry) => entry.taskTypeId === type.id);
  check("the type's tasks are counted once each", byType?.taskCount === 3, String(byType?.taskCount));
  check("average logged is per task", byType?.avgLoggedMinutes === 60, String(byType?.avgLoggedMinutes));
  check("average estimated is per task", byType?.avgEstimatedMinutes === 60, String(byType?.avgEstimatedMinutes));

  const byPractice = summary.byPractice.find((entry) => entry.practiceId === practice.id);
  check("the practice's time rolls up", byPractice?.totalLoggedMinutes === 180, String(byPractice?.totalLoggedMinutes));
  check("one biller worked it", byPractice?.billerCount === 1, String(byPractice?.billerCount));

  console.log("\n=== filters ===");

  const narrowed = await getTimeLogSummary({
    from: at(0),
    to: at(10),
    practiceIds: [practice.id],
  });
  check(
    "the window bounds the sessions",
    narrowed.totalLoggedMinutes === 30,
    String(narrowed.totalLoggedMinutes),
  );
  check(
    "a partial window still cannot overrun on 30 of 60 minutes",
    narrowed.overrunTaskCount === 0,
    String(narrowed.overrunTaskCount),
  );

  const otherType = await getTimeLogSummary({
    from: at(0),
    to: at(23),
    practiceIds: [practice.id],
    taskTypeIds: ["nonexistent-type-id"],
  });
  check("an unmatched task type returns nothing", otherType.sessionCount === 0);

  // Cleanup.
  const taskIds = [over.id, under.id, unestimated.id];
  await prisma.taskTimeLog.deleteMany({ where: { taskId: { in: taskIds } } });
  await prisma.taskNote.deleteMany({ where: { taskId: { in: taskIds } } });
  await prisma.task.deleteMany({ where: { id: { in: taskIds } } });
  await prisma.taskType.delete({ where: { id: type.id } });
  await prisma.practice.delete({ where: { id: practice.id } });

  const leftover = await prisma.task.count({
    where: { title: { startsWith: "ZZ TimeLog" } },
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
