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

  const friday = toUtcDate("2026-07-31");
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

  const { createNextInstance, generateInitialInstances, closeSeries } =
    await import("../lib/task/recurrence");

  console.log("\n=== series generation ===");

  const parent = await prisma.task.create({
    data: {
      title: "ZZ Recurring parent",
      createdById: owner.id,
      assignedToId: owner.id,
      isRecurring: true,
      recurringConfig: {
        frequency: "weekly",
        daysOfWeek: [1, 2, 3, 4, 5],
        nextDueDate: "2026-07-30",
      },
    },
  });

  const initial = await generateInitialInstances(parent, 3);
  check("generates three instances", initial.length === 3, String(initial.length));
  check(
    "instances numbered from 1",
    initial.map((task) => task.instanceNumber).join(",") === "1,2,3",
    initial.map((task) => task.instanceNumber).join(","),
  );
  check(
    "instances inherit the assignee",
    initial.every((task) => task.assignedToId === owner.id),
  );
  check(
    "instances are not themselves recurring",
    initial.every((task) => !task.isRecurring),
  );

  const advanced = await prisma.task.findUnique({ where: { id: parent.id } });
  const advancedConfig = parseRecurringConfig(advanced!.recurringConfig);
  check(
    "parent advanced past the generated dates",
    advancedConfig?.nextDueDate === "2026-08-04",
    advancedConfig?.nextDueDate ?? "none",
  );

  console.log("\n=== completing tops the series up ===");

  const fourth = await createNextInstance(advanced!);
  check("a fourth instance is created", fourth !== null);
  check(
    "it is numbered 4",
    fourth?.instanceNumber === 4,
    String(fourth?.instanceNumber),
  );
  check(
    "it takes the parent's next date",
    fourth?.dueDate?.toISOString().slice(0, 10) === "2026-08-04",
    fourth?.dueDate?.toISOString().slice(0, 10) ?? "none",
  );

  // Generating the same date twice would double the work, not repeat it.
  const stale = await prisma.task.findUnique({ where: { id: parent.id } });
  await prisma.task.update({
    where: { id: parent.id },
    data: {
      recurringConfig: { ...parseRecurringConfig(stale!.recurringConfig)!, nextDueDate: "2026-08-04" },
    },
  });

  const reloaded = await prisma.task.findUnique({ where: { id: parent.id } });
  const duplicate = await createNextInstance(reloaded!);
  check("a clashing date creates nothing", duplicate === null);

  const afterClash = await prisma.task.findUnique({ where: { id: parent.id } });
  check(
    "but the series still advances past it",
    parseRecurringConfig(afterClash!.recurringConfig)?.nextDueDate !== "2026-08-04",
    parseRecurringConfig(afterClash!.recurringConfig)?.nextDueDate ?? "none",
  );

  console.log("\n=== closing the parent closes the series ===");

  const closed = await closeSeries(parent.id, owner.id);
  check("pending instances were closed", closed >= 4, String(closed));

  const stillOpen = await prisma.task.count({
    where: { parentTaskId: parent.id, status: { not: TaskStatus.CLOSED } },
  });
  check("nothing is left open", stillOpen === 0, String(stillOpen));

  const noteCount = await prisma.taskNote.count({
    where: { task: { parentTaskId: parent.id } },
  });
  check("each closure was logged", noteCount >= 4, String(noteCount));

  console.log("\n=== task types ===");

  const types = await prisma.taskType.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
  });

  check("nine default types are seeded", types.length >= 9, String(types.length));
  check(
    "Charge Posting sorts first",
    types[0]?.name === "Charge Posting",
    types[0]?.name ?? "none",
  );

  // Cleanup — children first, then the parent they cascade from.
  await prisma.taskNote.deleteMany({
    where: { task: { OR: [{ id: parent.id }, { parentTaskId: parent.id }] } },
  });
  await prisma.task.deleteMany({ where: { parentTaskId: parent.id } });
  await prisma.task.deleteMany({ where: { title: { startsWith: "ZZ " } } });

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
