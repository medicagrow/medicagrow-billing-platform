/**
 * Task timer: logging, the 48-hour edit window, and overlap rejection.
 *
 *   npx tsx scripts/test-timer.ts
 *
 * Creates ZZ-prefixed rows and removes them at the end. It never touches
 * real data.
 */

import { PrismaClient, TaskStatus } from "../lib/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { config } from "dotenv";
import { getTaskLabel } from "../lib/task/task-label";
import { productivityConfigFor } from "../lib/task/productivity-config";

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

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);

async function main() {
  // lib/task/timer.ts imports lib/prisma, which reads DATABASE_URL the moment
  // it loads — so it cannot be imported before config() has run.
  const {
    findOverlappingLog,
    isWithinEditWindow,
    minutesBetween,
    recalculateTotalLoggedMinutes,
    stopActiveTimerFor,
  } = await import("../lib/task/timer");

  console.log("=== pure helpers ===");
  {
    const start = new Date("2026-07-31T09:00:00.000Z");
    const end = new Date("2026-07-31T10:30:00.000Z");
    check("minutes between", minutesBetween(start, end) === 90, String(minutesBetween(start, end)));
    check("negative range floors at zero", minutesBetween(end, start) === 0);

    check("just-logged time is editable", isWithinEditWindow(minutesAgo(30)));
    check("yesterday is editable", isWithinEditWindow(minutesAgo(60 * 30)));
    check("three days ago is not", !isWithinEditWindow(minutesAgo(60 * 72)));
  }

  console.log("\n=== task labels ===");
  {
    check(
      "type and practice",
      getTaskLabel({ taskType: { name: "Charge Posting" }, practice: { name: "Livewellness" } }) ===
        "Charge Posting — Livewellness",
    );
    check("type alone", getTaskLabel({ taskType: { name: "Report" } }) === "Report");
    check("legacy title", getTaskLabel({ title: "Old task" }) === "Old task");
    check("nothing at all", getTaskLabel({}) === "Untitled Task");
  }

  console.log("\n=== productivity config ===");
  {
    check(
      "matches case-insensitively",
      productivityConfigFor("charge posting")?.countLabel === "Charges Posted",
    );
    check(
      "AR type is auto-sourced",
      productivityConfigFor("Claim Follow-up")?.autoSourceModule === "AR",
    );
    check("unknown type has no config", productivityConfigFor("Nonsense") === null);
    check("no type has no config", productivityConfigFor(null) === null);
  }

  const owner = await prisma.user.findFirst({ where: { role: "OWNER" } });
  if (!owner) throw new Error("no owner user to attribute test rows to");

  const type = await prisma.taskType.findFirst({ where: { isActive: true } });

  const makeTask = (title: string) =>
    prisma.task.create({
      data: {
        title,
        createdById: owner.id,
        assignedToId: owner.id,
        taskTypeId: type?.id ?? null,
      },
    });

  const taskA = await makeTask("ZZ Timer A");
  const taskB = await makeTask("ZZ Timer B");

  console.log("\n=== one running timer per user ===");

  await prisma.task.update({
    where: { id: taskA.id },
    data: { activeTimerStartedAt: minutesAgo(45), activeTimerUserId: owner.id },
  });

  // Starting elsewhere must stop the first and bank its minutes.
  const stopped = await stopActiveTimerFor(owner.id);
  check("the running timer was stopped", stopped?.taskId === taskA.id);
  check(
    "its duration was logged",
    (stopped?.durationMinutes ?? 0) >= 44 && (stopped?.durationMinutes ?? 0) <= 46,
    String(stopped?.durationMinutes),
  );

  const clearedA = await prisma.task.findUnique({ where: { id: taskA.id } });
  check("the task's timer fields cleared", clearedA?.activeTimerStartedAt === null);
  check(
    "totalLoggedMinutes was written",
    (clearedA?.totalLoggedMinutes ?? 0) >= 44,
    String(clearedA?.totalLoggedMinutes),
  );

  check("stopping with nothing running is a no-op", (await stopActiveTimerFor(owner.id)) === null);

  console.log("\n=== totals are recalculated, not incremented ===");

  await prisma.taskTimeLog.create({
    data: {
      taskId: taskA.id,
      userId: owner.id,
      startedAt: minutesAgo(200),
      stoppedAt: minutesAgo(170),
      durationMinutes: 30,
    },
  });

  const total = await recalculateTotalLoggedMinutes(taskA.id);
  const logs = await prisma.taskTimeLog.findMany({ where: { taskId: taskA.id } });
  const summed = logs.reduce((n, log) => n + (log.durationMinutes ?? 0), 0);
  check("total equals the sum of its logs", total === summed, `${total} vs ${summed}`);

  // Halving a log and recalculating must move the total with it.
  await prisma.taskTimeLog.updateMany({
    where: { taskId: taskA.id, durationMinutes: 30 },
    data: { durationMinutes: 15 },
  });
  const afterEdit = await recalculateTotalLoggedMinutes(taskA.id);
  check("an edited log moves the total", afterEdit === total - 15, String(afterEdit));

  console.log("\n=== overlap detection ===");

  // A fixed past day. findOverlappingLog scans the probe's calendar day, so
  // anchoring here keeps these checks clear of the logs the section above
  // created relative to now — whatever time of day the suite happens to run.
  const base = new Date("2026-01-15T09:00:00.000Z");
  const at = (h: number, m = 0) =>
    new Date(base.getTime() + h * 3_600_000 + m * 60_000);

  const existing = await prisma.taskTimeLog.create({
    data: {
      taskId: taskB.id,
      userId: owner.id,
      startedAt: at(0),
      stoppedAt: at(1),
      durationMinutes: 60,
    },
  });

  const other = await prisma.taskTimeLog.create({
    data: {
      taskId: taskA.id,
      userId: owner.id,
      startedAt: at(3),
      stoppedAt: at(4),
      durationMinutes: 60,
    },
  });

  check(
    "a range landing inside another is caught",
    (await findOverlappingLog(owner.id, at(0, 30), at(1, 30), other.id))?.logId === existing.id,
  );
  check(
    "a range swallowing another is caught",
    (await findOverlappingLog(owner.id, at(-1), at(2), other.id))?.logId === existing.id,
  );
  check(
    "a clear range is allowed",
    (await findOverlappingLog(owner.id, at(6), at(7), other.id)) === null,
  );
  check(
    "touching end-to-start is not an overlap",
    (await findOverlappingLog(owner.id, at(1), at(2), other.id)) === null,
  );
  check(
    "the log being edited is excluded from its own check",
    (await findOverlappingLog(owner.id, at(3), at(4), other.id)) === null,
  );

  // Cleanup.
  await prisma.taskTimeEditRequest.deleteMany({
    where: { timeLog: { taskId: { in: [taskA.id, taskB.id] } } },
  });
  await prisma.taskTimeLog.deleteMany({ where: { taskId: { in: [taskA.id, taskB.id] } } });
  await prisma.taskNote.deleteMany({ where: { taskId: { in: [taskA.id, taskB.id] } } });
  await prisma.task.deleteMany({ where: { title: { startsWith: "ZZ Timer" } } });

  const leftover = await prisma.task.count({ where: { title: { startsWith: "ZZ Timer" } } });
  check("test rows cleaned up", leftover === 0, String(leftover));

  // Nothing above should have disturbed a real task.
  const stray = await prisma.task.count({
    where: { status: { not: TaskStatus.CLOSED }, activeTimerUserId: { not: null } },
  });
  console.log(`      (tasks with a live timer right now: ${stray})`);
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
