/**
 * Moves weekend occurrences of daily series onto the following Monday.
 *
 *   npx tsx scripts/fix-daily-recurring-weekends.ts          # report only
 *   npx tsx scripts/fix-daily-recurring-weekends.ts --apply  # move them
 *
 * "Daily" now means every business day. Series created before that change
 * generated Saturday and Sunday occurrences, which nobody was ever going to
 * work — they sat in the queue looking overdue.
 *
 * Only **OPEN** instances move: a weekend occurrence somebody actually closed
 * is a record of work that happened, and rewriting its due date would make the
 * history disagree with the productivity reports. Idempotent — a second run
 * finds nothing, because everything it touched now falls on a weekday.
 */

import { PrismaClient } from "../lib/generated/prisma/client";
import { TaskStatus } from "../lib/generated/prisma/enums";
import { PrismaPg } from "@prisma/adapter-pg";
import { config as loadEnv } from "dotenv";
import {
  isWeekend,
  parseRecurringConfig,
  toIsoDate,
  toUtcDate,
} from "../lib/task/recurrence-config";

loadEnv({ path: ".env.local" });

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const apply = process.argv.includes("--apply");

/** Saturday and Sunday both land on the Monday after them. */
function followingMonday(date: Date): Date {
  const next = new Date(date.getTime());
  while (isWeekend(next)) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

async function main() {
  const parents = await prisma.task.findMany({
    where: { isRecurring: true },
    select: { id: true, title: true, recurringConfig: true },
  });

  const daily = parents.filter(
    (parent) => parseRecurringConfig(parent.recurringConfig)?.frequency === "daily",
  );

  console.log(
    `${daily.length} daily series of ${parents.length} recurring` +
      (apply ? "" : "  (dry run — pass --apply to move them)"),
  );

  let movedInstances = 0;
  let touchedSeries = 0;
  let rewoundMarks = 0;

  for (const parent of daily) {
    const instances = await prisma.task.findMany({
      where: { parentTaskId: parent.id, status: TaskStatus.OPEN },
      select: { id: true, dueDate: true },
    });

    const onWeekend = instances.filter(
      (task) => task.dueDate !== null && isWeekend(task.dueDate),
    );

    if (onWeekend.length > 0) {
      touchedSeries += 1;

      console.log(`  ${parent.title ?? parent.id}: ${onWeekend.length} instance(s)`);

      for (const task of onWeekend) {
        const moved = followingMonday(task.dueDate!);

        console.log(
          `      ${toIsoDate(task.dueDate!)} → ${toIsoDate(moved)}`,
        );

        if (apply) {
          /**
           * Two weekend occurrences of one series both land on the same
           * Monday, and a Monday occurrence may already exist. The later
           * duplicates are deleted rather than stacked: they were never real
           * work, and two identical tasks on one day is worse than one.
           */
          const clash = await prisma.task.findFirst({
            where: {
              parentTaskId: parent.id,
              dueDate: moved,
              id: { not: task.id },
            },
            select: { id: true },
          });

          if (clash) {
            await prisma.taskNote.deleteMany({ where: { taskId: task.id } });
            await prisma.taskTimeLog.deleteMany({ where: { taskId: task.id } });
            await prisma.task.delete({ where: { id: task.id } });
          } else {
            await prisma.task.update({
              where: { id: task.id },
              data: { dueDate: moved },
            });
          }
        }

        movedInstances += 1;
      }
    }

    // The high-water mark decides what gets generated next, so a weekend one
    // would recreate the problem on the next sweep.
    const parsed = parseRecurringConfig(parent.recurringConfig);

    if (parsed && isWeekend(toUtcDate(parsed.nextDueDate))) {
      const moved = toIsoDate(followingMonday(toUtcDate(parsed.nextDueDate)));

      console.log(
        `  ${parent.title ?? parent.id}: mark ${parsed.nextDueDate} → ${moved}`,
      );

      rewoundMarks += 1;

      if (apply) {
        await prisma.task.update({
          where: { id: parent.id },
          data: { recurringConfig: { ...parsed, nextDueDate: moved } },
        });
      }
    }
  }

  console.log(
    `\n${apply ? "Fixed" : "Would fix"} ${movedInstances} instance${
      movedInstances === 1 ? "" : "s"
    } across ${touchedSeries} series` +
      `, and ${apply ? "moved" : "would move"} ${rewoundMarks} schedule mark${
        rewoundMarks === 1 ? "" : "s"
      }.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
