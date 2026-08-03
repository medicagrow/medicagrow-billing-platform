/**
 * One-off cleanup for the recurrence change.
 *
 *   npx tsx scripts/cleanup-future-recurring-instances.ts          # report only
 *   npx tsx scripts/cleanup-future-recurring-instances.ts --apply  # delete
 *
 * Series used to be seeded three occurrences deep. They now produce one
 * occurrence at a time, on its due date, so the pre-generated future rows have
 * to go: for each series the earliest open instance is kept and every later
 * open instance dated after today is deleted, then the parent's high-water
 * mark is set to the occurrence after the one that was kept.
 *
 * Only untouched work is removed — an instance that is not OPEN, or that has
 * notes or logged time against it, is left exactly where it is. Deleting is
 * hard rather than soft: these rows were never worked, and a soft-deleted
 * phantom would still have to be filtered out of every query forever.
 */

import { PrismaClient } from "../lib/generated/prisma/client";
import { TaskStatus } from "../lib/generated/prisma/enums";
import { PrismaPg } from "@prisma/adapter-pg";
import { config as loadEnv } from "dotenv";
import {
  nextOccurrence,
  parseRecurringConfig,
  toIsoDate,
  toUtcDate,
} from "../lib/task/recurrence-config";

loadEnv({ path: ".env.local" });

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const apply = process.argv.includes("--apply");

function todayIso(): string {
  const now = new Date();
  return toIsoDate(
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())),
  );
}

async function main() {
  const today = todayIso();

  const parents = await prisma.task.findMany({
    where: { isRecurring: true },
    select: { id: true, title: true, recurringConfig: true },
  });

  console.log(
    `${parents.length} recurring series; today is ${today}` +
      (apply ? "" : "  (dry run — pass --apply to delete)"),
  );

  let deleted = 0;
  let rewound = 0;

  for (const parent of parents) {
    const instances = await prisma.task.findMany({
      where: { parentTaskId: parent.id, status: TaskStatus.OPEN },
      orderBy: { dueDate: "asc" },
      select: {
        id: true,
        dueDate: true,
        totalLoggedMinutes: true,
        _count: { select: { notes: true, timeLogs: true } },
      },
    });

    if (instances.length <= 1) continue;

    // The first open occurrence is the one being worked; everything after it
    // that is still in the future was generated ahead of its time.
    const [, ...later] = instances;

    const removable = later.filter(
      (task) =>
        task.dueDate !== null &&
        toIsoDate(task.dueDate) > today &&
        task._count.notes === 0 &&
        task._count.timeLogs === 0 &&
        task.totalLoggedMinutes === 0,
    );

    if (removable.length === 0) continue;

    const kept = instances[0]!;
    console.log(
      `  ${parent.title ?? parent.id}: keeping ${
        kept.dueDate ? toIsoDate(kept.dueDate) : "no date"
      }, removing ${removable.length}`,
    );

    if (apply) {
      await prisma.task.deleteMany({
        where: { id: { in: removable.map((task) => task.id) } },
      });
    }

    deleted += removable.length;

    /**
     * The mark must point at the occurrence after the one that was kept —
     * otherwise the sweep would either skip straight past the deleted dates or
     * recreate them.
     */
    const parsed = parseRecurringConfig(parent.recurringConfig);

    if (parsed && kept.dueDate) {
      const following = nextOccurrence(parsed, toUtcDate(toIsoDate(kept.dueDate)));

      if (following) {
        const nextDueDate = toIsoDate(following);

        if (nextDueDate !== parsed.nextDueDate) {
          console.log(`      mark ${parsed.nextDueDate} -> ${nextDueDate}`);
          rewound += 1;

          if (apply) {
            await prisma.task.update({
              where: { id: parent.id },
              data: { recurringConfig: { ...parsed, nextDueDate } },
            });
          }
        }
      }
    }
  }

  console.log(
    `\n${apply ? "Deleted" : "Would delete"} ${deleted} pre-generated instance(s); ` +
      `${apply ? "rewound" : "would rewind"} ${rewound} series mark(s).`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
