/**
 * Auto-stop, the review queue, and the rule that pending hours count nowhere
 * (01 P1-01, CALC-02).
 *
 *   npx tsx scripts/test-timer-autostop.ts
 *
 * The exclusion is the part worth testing hardest: "not counted" has to mean
 * every report, and the failure mode is one reader that forgot. So this asserts
 * it through the shared helpers each report actually uses rather than by
 * re-deriving the condition here.
 *
 * Creates ZZ-prefixed rows and removes them at the end. Pipe to `tail`, not
 * `head` — a closed pipe kills the script before its cleanup.
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { config } from "dotenv";
import { PrismaClient } from "../lib/generated/prisma/client";
import {
  EhrSource,
  Role,
  TaskStatus,
  TimerReviewStatus,
} from "../lib/generated/prisma/enums";

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
const MINUTE = 60_000;

async function main() {
  const { autoStopRunawayTimers } = await import("../lib/task/auto-stop");
  const { getMaxSessionMinutes } = await import("../lib/app-settings");
  const { COUNTED_SESSION_WHERE, recalculateTotalLoggedMinutes } = await import(
    "../lib/task/timer"
  );
  const { getShiftDay } = await import("../lib/shift-day");

  const owner = await prisma.user.findFirst({
    where: { role: Role.OWNER, isActive: true },
    orderBy: { createdAt: "asc" },
  });
  if (!owner) throw new Error("no owner user to hang the fixtures on");

  const [biller, mate] = await Promise.all(
    ["Biller", "Mate"].map((suffix) =>
      prisma.user.create({
        data: {
          name: `ZZ Autostop ${suffix}`,
          email: `zz-autostop-${suffix.toLowerCase()}-${STAMP}@example.test`,
          hashedPassword: "not-a-real-hash",
          role: Role.BILLER,
        },
      }),
    ),
  );

  const practice = await prisma.practice.create({
    data: { name: `ZZ Autostop Practice ${STAMP}`, ehrSource: EhrSource.OPEN_PM },
  });

  const makeTask = (title: string) =>
    prisma.task.create({
      data: {
        title: `ZZ ${title}`,
        practiceId: practice.id,
        createdById: owner.id,
        assignedToId: biller.id,
        status: TaskStatus.OPEN,
        estimatedMinutes: 60,
      },
    });

  try {
    const cap = await getMaxSessionMinutes();
    check("the cap is a sane number of minutes", cap > 0 && cap <= 24 * 60, `${cap}`);

    /* ------------------------------------------------ the sweep ---------- */
    console.log("\n=== the sweep ===");

    const stale = await makeTask("stale timer");
    const fresh = await makeTask("fresh timer");
    const now = new Date();

    await prisma.task.update({
      where: { id: stale.id },
      data: {
        activeTimerUserId: biller.id,
        // Comfortably past the cap.
        activeTimerStartedAt: new Date(now.getTime() - (cap + 120) * MINUTE),
      },
    });
    await prisma.task.update({
      where: { id: fresh.id },
      data: {
        activeTimerUserId: mate!.id,
        activeTimerStartedAt: new Date(now.getTime() - 30 * MINUTE),
      },
    });

    /**
     * Scoped to the fixtures. Unscoped, this would stop whatever real timers
     * happen to be running when the suite is run — which is correct in
     * production and unacceptable in a test.
     */
    const result = await autoStopRunawayTimers(now, {
      userIds: [biller!.id, mate!.id],
    });
    check("the sweep stops exactly the one past the cap", result.stopped === 1, JSON.stringify(result));

    const staleAfter = await prisma.task.findUnique({ where: { id: stale.id } });
    const freshAfter = await prisma.task.findUnique({ where: { id: fresh.id } });

    check(
      "the runaway timer is cleared from the task",
      staleAfter?.activeTimerUserId === null &&
        staleAfter?.activeTimerStartedAt === null,
    );
    check(
      "a timer still inside the cap is left running",
      freshAfter?.activeTimerUserId === mate!.id,
    );

    const log = await prisma.taskTimeLog.findFirst({
      where: { taskId: stale.id },
    });

    check("a session was written", Boolean(log));
    check("it is marked auto-stopped", log?.autoStopped === true);
    check(
      "it is pending review",
      log?.reviewStatus === TimerReviewStatus.PENDING,
    );
    check(
      "it is capped at the limit, not at 'now'",
      log?.durationMinutes === cap,
      `${log?.durationMinutes} vs cap ${cap}`,
    );
    check(
      "the stop time sits between the start and now",
      Boolean(log?.stoppedAt && log.stoppedAt > log.startedAt && log.stoppedAt <= now),
    );

    /* ----------------------------------- pending counts nowhere ---------- */
    console.log("\n=== pending hours are counted nowhere ===");

    check(
      "the task's own total excludes it",
      (await recalculateTotalLoggedMinutes(stale.id)) === 0,
    );

    const countedForTask = await prisma.taskTimeLog.count({
      where: { taskId: stale.id, ...COUNTED_SESSION_WHERE },
    });
    check("the shared session filter excludes it", countedForTask === 0);

    const allForTask = await prisma.taskTimeLog.count({
      where: { taskId: stale.id },
    });
    check("…while the session itself still exists", allForTask === 1);

    // Every report reads through one of these two helpers.
    const { sessionWhere } = await import("../lib/analytics/shared");
    const analyticsWhere = sessionWhere({
      from: new Date(now.getTime() - 7 * 24 * 60 * MINUTE),
      to: new Date(now.getTime() + MINUTE),
      billerIds: [biller.id],
    });
    check(
      "analytics does not count it",
      (await prisma.taskTimeLog.count({ where: analyticsWhere })) === 0,
    );

    const timeAnalysis = await import("../lib/time-analysis");
    const logWhere = timeAnalysis.sessionWhere({
      from: new Date(now.getTime() - 7 * 24 * 60 * MINUTE),
      to: new Date(now.getTime() + MINUTE),
      userIds: [biller.id],
    });
    check(
      "the session log and summary do not count it",
      (await prisma.taskTimeLog.count({ where: logWhere })) === 0,
    );

    /* ------------------------------------------- approval counts --------- */
    console.log("\n=== approval puts the hours back ===");

    const corrected = new Date(log!.startedAt.getTime() + 45 * MINUTE);

    await prisma.taskTimeLog.update({
      where: { id: log!.id },
      data: {
        stoppedAt: corrected,
        durationMinutes: 45,
        reviewStatus: TimerReviewStatus.APPROVED,
        reviewedById: owner.id,
        reviewedAt: new Date(),
        isEdited: true,
        originalDurationMinutes: cap,
      },
    });

    await prisma.taskTimeLogAdjustment.create({
      data: {
        logId: log!.id,
        oldStoppedAt: log!.stoppedAt,
        newStoppedAt: corrected,
        oldDurationMinutes: cap,
        newDurationMinutes: 45,
        note: "ZZ corrected",
        changedById: owner.id,
      },
    });

    check(
      "the approved session counts again",
      (await prisma.taskTimeLog.count({
        where: { taskId: stale.id, ...COUNTED_SESSION_WHERE },
      })) === 1,
    );
    check(
      "the task total picks up the corrected figure",
      (await recalculateTotalLoggedMinutes(stale.id)) === 45,
    );
    check(
      "analytics counts it once approved",
      (await prisma.taskTimeLog.count({ where: analyticsWhere })) === 1,
    );

    const adjustments = await prisma.taskTimeLogAdjustment.findMany({
      where: { logId: log!.id },
    });
    check("the correction is recorded", adjustments.length === 1);
    check(
      "it keeps the figure it replaced",
      adjustments[0]?.oldDurationMinutes === cap &&
        adjustments[0]?.newDurationMinutes === 45,
    );

    // A second correction must not overwrite the first.
    await prisma.taskTimeLogAdjustment.create({
      data: {
        logId: log!.id,
        oldStoppedAt: corrected,
        newStoppedAt: new Date(log!.startedAt.getTime() + 30 * MINUTE),
        oldDurationMinutes: 45,
        newDurationMinutes: 30,
        changedById: owner.id,
      },
    });
    check(
      "a twice-corrected session keeps both steps",
      (await prisma.taskTimeLogAdjustment.count({ where: { logId: log!.id } })) === 2,
      "the single originalDurationMinutes column could not",
    );

    /* -------------------------------------------------- shift day -------- */
    console.log("\n=== shift day ===");

    // IST is UTC+5:30, so neither shift crosses a UTC date boundary.
    const dayShift = new Date("2026-10-23T03:30:00.000Z"); // 09:00 IST
    const nightStart = new Date("2026-10-23T13:00:00.000Z"); // 18:30 IST
    const afterMidnight = new Date("2026-10-23T20:30:00.000Z"); // 02:00 IST 24th

    check(
      "day-shift work lands on its own date",
      getShiftDay(biller.id, dayShift) === "2026-10-23",
    );
    check(
      "night-shift work before midnight lands on the start date",
      getShiftDay(biller.id, nightStart) === "2026-10-23",
    );
    check(
      "night-shift work after midnight IST still lands on the start date",
      getShiftDay(biller.id, afterMidnight) === "2026-10-23",
      "02:00 IST on the 24th is 20:30 UTC on the 23rd",
    );
  } finally {
    /**
     * Only ZZ rows. Deleting the ZZ tasks takes their adjustments and logs
     * with them (both cascade), and clears the running timer with them, so
     * nothing here reaches a real user's record.
     */
    await prisma.task.deleteMany({ where: { practiceId: practice.id } });
    await prisma.practice.delete({ where: { id: practice.id } });
    await prisma.user.deleteMany({
      where: { id: { in: [biller!.id, mate!.id] } },
    });
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
