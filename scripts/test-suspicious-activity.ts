/**
 * Suspicious-activity flags and the thresholds behind them.
 *
 *   npx tsx scripts/test-suspicious-activity.ts
 *
 * These flags put somebody's name next to a question about their honesty, so
 * the boundaries matter more than usual: one minute either side of a threshold
 * decides whether a person is asked to explain themselves. Every rule is
 * checked at the value that should trip it and the value that should not.
 *
 * Creates ZZ-prefixed rows and removes them at the end.
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

/** A window far in the past — no real session can land in it. */
const FROM = new Date("2019-05-01T00:00:00.000Z");
const TO = new Date("2019-05-31T23:59:59.999Z");

const at = (day: number, hour = 9) =>
  new Date(`2019-05-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00.000Z`);

const stamp = Date.now();

async function main() {
  const { getSuspiciousActivity, THRESHOLDS } = await import(
    "../lib/analytics/suspicious-activity"
  );

  const owner = await prisma.user.findFirst({ where: { role: "OWNER" } });
  if (!owner) throw new Error("no owner user to attribute test rows to");

  const practice = await prisma.practice.create({
    data: { name: "ZZ Flags Practice", ehrSource: EhrSource.OPEN_PM },
  });

  const taskType = await prisma.taskType.create({
    data: { name: "ZZ Flags Type", sortOrder: 9999 },
  });

  const biller = await prisma.user.create({
    data: {
      name: "ZZ Flags Biller",
      email: `zz-flags-${stamp}@example.test`,
      hashedPassword: "not-a-real-hash",
    },
  });

  const makeTask = async (opts: {
    title: string;
    estimatedMinutes: number | null;
    totalLoggedMinutes?: number;
    productivityCount?: number | null;
    closedOn?: Date | null;
  }) =>
    prisma.task.create({
      data: {
        title: opts.title,
        createdById: owner.id,
        assignedToId: biller.id,
        practiceId: practice.id,
        taskTypeId: taskType.id,
        estimatedMinutes: opts.estimatedMinutes,
        totalLoggedMinutes: opts.totalLoggedMinutes ?? 0,
        productivityCount: opts.productivityCount ?? null,
        ...(opts.closedOn
          ? {
              status: TaskStatus.CLOSED,
              completedAt: opts.closedOn,
              completedById: biller.id,
            }
          : {}),
      },
    });

  const logFor = (taskId: string, day: number, minutes: number) =>
    prisma.taskTimeLog.create({
      data: {
        taskId,
        userId: biller.id,
        startedAt: at(day),
        stoppedAt: new Date(at(day).getTime() + minutes * 60_000),
        durationMinutes: minutes,
      },
    });

  const run = () =>
    getSuspiciousActivity({ from: FROM, to: TO, billerIds: [biller.id] });

  const created: string[] = [];

  console.log("=== SHORT_TIMER: brief session on a substantial task ===");
  {
    // 4 minutes against a 60-minute estimate — under the 5-minute line.
    const tripped = await makeTask({
      title: "ZZ Flags short",
      estimatedMinutes: 60,
    });
    await logFor(tripped.id, 2, THRESHOLDS.shortTimerMaxMinutes - 1);

    // Exactly at the line is not under it.
    const boundary = await makeTask({
      title: "ZZ Flags short boundary",
      estimatedMinutes: 60,
    });
    await logFor(boundary.id, 3, THRESHOLDS.shortTimerMaxMinutes);

    // Brief, but the task was never a big one.
    const smallTask = await makeTask({
      title: "ZZ Flags short small estimate",
      estimatedMinutes: THRESHOLDS.shortTimerMinEstimate - 1,
    });
    await logFor(smallTask.id, 4, 2);

    created.push(tripped.id, boundary.id, smallTask.id);

    const result = await run();
    const flagged = result.sessions.filter(
      (session) => session.flagType === "SHORT_TIMER",
    );

    check(
      "a 4-minute session on a 60-minute task is flagged",
      flagged.some((session) => session.taskId === tripped.id),
    );
    check(
      "exactly 5 minutes is not",
      !flagged.some((session) => session.taskId === boundary.id),
    );
    check(
      "a brief session on a 29-minute task is not",
      !flagged.some((session) => session.taskId === smallTask.id),
    );
  }

  console.log("\n=== EXTREME_OVERRUN: three times the estimate ===");
  {
    const tripped = await makeTask({
      title: "ZZ Flags overrun",
      estimatedMinutes: 30,
      totalLoggedMinutes: 90, // exactly 3x — at the threshold, which counts
      productivityCount: 5,
      closedOn: at(10),
    });

    const under = await makeTask({
      title: "ZZ Flags overrun under",
      estimatedMinutes: 30,
      totalLoggedMinutes: 89,
      productivityCount: 5,
      closedOn: at(11),
    });

    const noEstimate = await makeTask({
      title: "ZZ Flags overrun no estimate",
      estimatedMinutes: null,
      totalLoggedMinutes: 500,
      productivityCount: 5,
      closedOn: at(12),
    });

    created.push(tripped.id, under.id, noEstimate.id);

    const result = await run();
    const flagged = result.sessions.filter(
      (session) => session.flagType === "EXTREME_OVERRUN",
    );

    check(
      "exactly 3x the estimate is flagged",
      flagged.some((session) => session.taskId === tripped.id),
    );
    check(
      "just under 3x is not",
      !flagged.some((session) => session.taskId === under.id),
    );
    // Without an estimate there is no budget, so there is nothing to overrun.
    check(
      "a task with no estimate cannot overrun",
      !flagged.some((session) => session.taskId === noEstimate.id),
    );
  }

  console.log("\n=== NO_PRODUCTIVITY: closed, timed, nothing counted ===");
  {
    const nullCount = await makeTask({
      title: "ZZ Flags no count",
      estimatedMinutes: 60,
      totalLoggedMinutes: 55,
      productivityCount: null,
      closedOn: at(14),
    });
    await logFor(nullCount.id, 14, 55);

    const zeroCount = await makeTask({
      title: "ZZ Flags zero count",
      estimatedMinutes: 60,
      totalLoggedMinutes: 55,
      productivityCount: 0,
      closedOn: at(15),
    });
    await logFor(zeroCount.id, 15, 55);

    const counted = await makeTask({
      title: "ZZ Flags counted",
      estimatedMinutes: 60,
      totalLoggedMinutes: 55,
      productivityCount: 12,
      closedOn: at(16),
    });
    await logFor(counted.id, 16, 55);

    // Closed with no count, but nobody ran a timer — nothing to explain.
    const untimed = await makeTask({
      title: "ZZ Flags untimed",
      estimatedMinutes: 60,
      productivityCount: null,
      closedOn: at(17),
    });

    created.push(nullCount.id, zeroCount.id, counted.id, untimed.id);

    const result = await run();
    const flagged = result.sessions.filter(
      (session) => session.flagType === "NO_PRODUCTIVITY",
    );

    check(
      "a null count is flagged",
      flagged.some((session) => session.taskId === nullCount.id),
    );
    check(
      "a zero count is flagged",
      flagged.some((session) => session.taskId === zeroCount.id),
    );
    check(
      "a real count is not",
      !flagged.some((session) => session.taskId === counted.id),
    );
    check(
      "no timer means nothing to explain",
      !flagged.some((session) => session.taskId === untimed.id),
    );
  }

  console.log("\n=== PATTERN: the same thing, repeatedly ===");
  {
    const result = await run();

    // Three NO_PRODUCTIVITY tasks were built above minus the counted one; the
    // short-timer set contributes its own. A pattern needs three of a kind.
    const pattern = result.patterns.find(
      (entry) => entry.billerId === biller.id,
    );

    check(
      "a pattern needs at least three occurrences",
      pattern === undefined || pattern.occurrences >= THRESHOLDS.patternOccurrences,
      pattern ? `${pattern.flagType} × ${pattern.occurrences}` : "none yet",
    );

    // Push one flag type past the line and it must appear.
    for (const day of [20, 21, 22]) {
      const task = await makeTask({
        title: `ZZ Flags pattern ${day}`,
        estimatedMinutes: 60,
        totalLoggedMinutes: 2,
        productivityCount: null,
        closedOn: at(day),
      });
      await logFor(task.id, day, 2);
      created.push(task.id);
    }

    const after = await run();
    const found = after.patterns.filter(
      (entry) => entry.billerId === biller.id,
    );

    check("a repeated flag becomes a pattern", found.length > 0, String(found.length));
    check(
      "the pattern names the task type",
      found.every((entry) => entry.taskTypeName === "ZZ Flags Type"),
    );
    check(
      "severity is amber at 3-4 and red at 5+",
      found.every((entry) =>
        entry.occurrences >= 5
          ? entry.severity === "red"
          : entry.severity === "amber",
      ),
      found.map((entry) => `${entry.occurrences}:${entry.severity}`).join(", "),
    );
  }

  console.log("\n=== dismissal ===");
  {
    const result = await run();
    const target = result.sessions.find((session) => !session.dismissed);

    if (target) {
      await prisma.analyticsFlagDismissal.create({
        data: {
          flagKey: target.flagKey,
          flagType: target.flagType,
          dismissedById: owner.id,
        },
      });

      const after = await run();
      const same = after.sessions.find(
        (session) => session.flagKey === target.flagKey,
      );

      check("a dismissed flag comes back marked dismissed", same?.dismissed === true);
      check("and names who dismissed it", Boolean(same?.dismissedByName));
      check(
        "the summary stops counting it",
        after.summary[target.flagType] < result.summary[target.flagType],
        `${result.summary[target.flagType]} → ${after.summary[target.flagType]}`,
      );

      await prisma.analyticsFlagDismissal.deleteMany({
        where: { flagKey: target.flagKey },
      });
    }
  }

  console.log("\n=== filtering by flag type ===");
  {
    const onlyShort = await getSuspiciousActivity({
      from: FROM,
      to: TO,
      billerIds: [biller.id],
      flagTypes: ["SHORT_TIMER"],
    });

    check(
      "asking for one type returns only that type",
      onlyShort.sessions.every((session) => session.flagType === "SHORT_TIMER"),
    );
  }

  /* ------------------------------ cleanup ------------------------------- */

  await prisma.taskTimeLog.deleteMany({ where: { taskId: { in: created } } });
  await prisma.taskNote.deleteMany({ where: { taskId: { in: created } } });
  await prisma.task.deleteMany({ where: { id: { in: created } } });
  await prisma.user.delete({ where: { id: biller.id } });
  await prisma.taskType.delete({ where: { id: taskType.id } });
  await prisma.practice.delete({ where: { id: practice.id } });

  const leftover = await prisma.task.count({
    where: { title: { startsWith: "ZZ Flags" } },
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
