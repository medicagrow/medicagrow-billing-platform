/**
 * Existing sessions longer than the cap, moved into the timer review queue
 * (01 P1-01, CALC-02).
 *
 *   npx tsx scripts/backfill-runaway-timers.ts            # dry run + report
 *   npx tsx scripts/backfill-runaway-timers.ts --confirm  # applies
 *
 * **It never edits a duration.** The spec is explicit: list the historical
 * sessions for the Owner to review through the same queue, do not auto-edit
 * them. All this does is set `reviewStatus = PENDING`, which takes the hours
 * out of every report until somebody confirms what actually happened.
 *
 * That is a visible change to past months, which is the point — those months
 * currently contain a six-day session and 18 others over a day. The report
 * below says exactly how many hours leave each person's each month, so
 * anything that was billed on them can be reconciled.
 *
 * Idempotent: a session already PENDING or APPROVED is left alone, so a second
 * run reports and changes nothing.
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { config } from "dotenv";
import { PrismaClient } from "../lib/generated/prisma/client";
import { TimerReviewStatus } from "../lib/generated/prisma/enums";

config({ path: ".env.local" });

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const confirmed = process.argv.includes("--confirm");

function hours(minutes: number): string {
  return (minutes / 60).toFixed(1).padStart(7);
}

async function main() {
  // Imported here rather than at the top: lib/app-settings reaches lib/prisma,
  // which reads DATABASE_URL at module load — before dotenv has run.
  const { DEFAULT_MAX_SESSION_MINUTES, MAX_SESSION_MINUTES_KEY } = await import(
    "../lib/app-settings"
  );

  const setting = await prisma.appSetting.findUnique({
    where: { settingKey: MAX_SESSION_MINUTES_KEY },
    select: { settingValue: true },
  });

  const cap = Number(setting?.settingValue ?? DEFAULT_MAX_SESSION_MINUTES);

  const candidates = await prisma.taskTimeLog.findMany({
    where: {
      durationMinutes: { gt: cap },
      reviewStatus: TimerReviewStatus.NOT_REQUIRED,
      stoppedAt: { not: null },
    },
    select: {
      id: true,
      userId: true,
      startedAt: true,
      durationMinutes: true,
      taskId: true,
      user: { select: { name: true } },
    },
    orderBy: { startedAt: "asc" },
  });

  console.log(
    `Cap is ${cap} minutes (${(cap / 60).toFixed(1)}h).\n` +
      `${candidates.length} session(s) over it and not yet in review.\n`,
  );

  if (candidates.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  /* ----------------- the reconciliation report, per user per month -------- */

  const byUserMonth = new Map<
    string,
    { name: string; month: string; sessions: number; minutes: number }
  >();

  for (const log of candidates) {
    const month = log.startedAt.toISOString().slice(0, 7);
    const key = `${log.userId}:${month}`;
    const row =
      byUserMonth.get(key) ??
      { name: log.user.name ?? "Unknown", month, sessions: 0, minutes: 0 };

    row.sessions += 1;
    row.minutes += log.durationMinutes ?? 0;
    byUserMonth.set(key, row);
  }

  const rows = Array.from(byUserMonth.values()).sort(
    (a, b) => a.month.localeCompare(b.month) || b.minutes - a.minutes,
  );

  console.log("Hours that will stop being counted until reviewed:\n");
  console.log("  month     hours  sessions  biller");

  let totalMinutes = 0;

  for (const row of rows) {
    totalMinutes += row.minutes;
    console.log(
      `  ${row.month}  ${hours(row.minutes)}  ${String(row.sessions).padStart(8)}  ${row.name}`,
    );
  }

  console.log(
    `\n  total   ${hours(totalMinutes)}  ${String(candidates.length).padStart(8)}\n`,
  );

  /* --------------------------------- apply -------------------------------- */

  if (!confirmed) {
    console.log("Dry run. Pass --confirm to move these into the review queue.");
    return;
  }

  const ids = candidates.map((log) => log.id);

  await prisma.taskTimeLog.updateMany({
    where: { id: { in: ids }, reviewStatus: TimerReviewStatus.NOT_REQUIRED },
    data: {
      reviewStatus: TimerReviewStatus.PENDING,
      autoStopped: true,
      autoStoppedAt: new Date(),
    },
  });

  /**
   * Each affected task's total has to drop by what is now pending, or the
   * task would still report hours no report counts.
   */
  const taskIds = Array.from(new Set(candidates.map((log) => log.taskId)));

  for (const taskId of taskIds) {
    const aggregate = await prisma.taskTimeLog.aggregate({
      where: {
        taskId,
        durationMinutes: { not: null },
        reviewStatus: { not: TimerReviewStatus.PENDING },
      },
      _sum: { durationMinutes: true },
    });

    await prisma.task.update({
      where: { id: taskId },
      data: { totalLoggedMinutes: aggregate._sum.durationMinutes ?? 0 },
    });
  }

  console.log(
    `Moved ${ids.length} session(s) into review across ${taskIds.length} task(s).\n` +
      "They appear on Tasks → Team under Timer review. Re-run to confirm none remain.",
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
