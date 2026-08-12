/**
 * Removes test fixtures that survived a crashed test run.
 *
 *   npx tsx scripts/cleanup-zz-test-data.ts            # dry run, prints only
 *   npx tsx scripts/cleanup-zz-test-data.ts --confirm  # actually deletes
 *
 * Every test script here creates `ZZ`-prefixed rows and removes them at the
 * end. A script that throws part-way never reaches its cleanup, so the rows
 * stay — and a leaked user is not inert: it is an active biller, so it appears
 * on the workload planner, in assignee dropdowns, and in the roll-ups. Nine of
 * them were contributing 675 fictional hours of spare capacity.
 *
 * **Dry run by default.** This deletes real rows from the real database, and a
 * pattern match is a blunt instrument — anything genuinely named "ZZ …" would
 * go with it. Printing first, deleting only on `--confirm`, is the difference
 * between a tool and an accident.
 *
 * Order matters. Most relations to User are **required**, so Postgres refuses
 * to delete a user while a work note, batch or task still points at them; the
 * children go first, deepest first. Practices are the opposite — almost
 * everything under one cascades — so they go last but need no unpicking.
 */

import { PrismaClient } from "../lib/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { config } from "dotenv";

config({ path: ".env.local" });

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const confirmed = process.argv.includes("--confirm");

/**
 * What counts as a fixture.
 *
 * The name prefix is the convention every test script follows. The email
 * pattern is the backstop: a fixture renamed by a test would still carry its
 * `zz-…@example.test` address, and `@example.test` is a reserved TLD that
 * cannot belong to a real person.
 */
const USER_MATCH = {
  OR: [
    { name: { startsWith: "ZZ" } },
    { email: { startsWith: "zz-" } },
    { email: { startsWith: "ZZ" } },
    { email: { contains: "@example.test" } },
  ],
};

const PRACTICE_MATCH = { name: { startsWith: "ZZ" } };

async function main() {
  console.log(
    confirmed
      ? "=== DELETING leaked test data ===\n"
      : "=== DRY RUN — nothing will be deleted (pass --confirm) ===\n",
  );

  const [users, practices] = await Promise.all([
    prisma.user.findMany({
      where: USER_MATCH,
      select: { id: true, name: true, email: true, role: true, isActive: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.practice.findMany({
      where: PRACTICE_MATCH,
      select: { id: true, name: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const userIds = users.map((user) => user.id);
  const practiceIds = practices.map((practice) => practice.id);

  console.log(`Users matched: ${users.length}`);
  for (const user of users) {
    console.log(
      `  ${user.name.padEnd(24)} ${user.role.padEnd(16)} ${user.email}`,
    );
  }

  console.log(`\nPractices matched: ${practices.length}`);
  for (const practice of practices) console.log(`  ${practice.name}`);

  if (users.length === 0 && practices.length === 0) {
    console.log("\nNothing to clean up.");
    return;
  }

  /**
   * A guard against the pattern being wider than intended. Every real user in
   * this deployment is a named member of staff, so matching most of the table
   * means the match is wrong, not that the table is full of fixtures.
   */
  const totalUsers = await prisma.user.count();

  if (users.length > 0 && users.length >= totalUsers / 2) {
    console.log(
      `\nREFUSING: ${users.length} of ${totalUsers} users matched. That is too` +
        " large a share to be test data — check the pattern before running this.",
    );
    process.exitCode = 1;
    return;
  }

  /** Everything the match owns, counted before and after. */
  const tally = async () => ({
    users: await prisma.user.count({ where: USER_MATCH }),
    practices: await prisma.practice.count({ where: PRACTICE_MATCH }),
    userPractices: await prisma.userPractice.count({
      where: { OR: [{ userId: { in: userIds } }, { practiceId: { in: practiceIds } }] },
    }),
    tasks: await prisma.task.count({
      where: {
        OR: [
          { assignedToId: { in: userIds } },
          { createdById: { in: userIds } },
          { practiceId: { in: practiceIds } },
        ],
      },
    }),
    taskTimeLogs: await prisma.taskTimeLog.count({
      where: { userId: { in: userIds } },
    }),
    todos: await prisma.todo.count({
      where: {
        OR: [{ assignedToId: { in: userIds } }, { createdById: { in: userIds } }],
      },
    }),
    arBatches: await prisma.arBatch.count({
      where: {
        OR: [{ uploadedById: { in: userIds } }, { practiceId: { in: practiceIds } }],
      },
    }),
    arWorkNotes: await prisma.arWorkNote.count({
      where: { workedById: { in: userIds } },
    }),
    eobBatches: await prisma.eobBatch.count({
      where: {
        OR: [{ postedById: { in: userIds } }, { practiceId: { in: practiceIds } }],
      },
    }),
    eobWorkNotes: await prisma.eobWorkNote.count({
      where: { workedById: { in: userIds } },
    }),
    trackerEntries: await prisma.trackerEntry.count({
      where: {
        OR: [{ enteredById: { in: userIds } }, { practiceId: { in: practiceIds } }],
      },
    }),
    timeBlocks: await prisma.timeBlock.count({
      where: { userId: { in: userIds } },
    }),
  });

  const before = await tally();

  console.log("\nRows owned by the match:");
  for (const [table, count] of Object.entries(before)) {
    console.log(`  ${table.padEnd(16)} ${count}`);
  }

  if (!confirmed) {
    console.log("\nDry run complete. Re-run with --confirm to delete.");
    return;
  }

  console.log("\nDeleting, children first…");

  const step = async (label: string, run: () => Promise<{ count: number }>) => {
    const { count } = await run();
    console.log(`  ${label.padEnd(34)} ${count}`);
  };

  /* -------- tasks: edit requests → time logs → notes → the tasks -------- */

  const taskWhere = {
    OR: [
      { assignedToId: { in: userIds } },
      { createdById: { in: userIds } },
      { practiceId: { in: practiceIds } },
    ],
  };

  const taskIds = (
    await prisma.task.findMany({ where: taskWhere, select: { id: true } })
  ).map((task) => task.id);

  await step("task time edit requests", () =>
    prisma.taskTimeEditRequest.deleteMany({
      where: {
        OR: [
          { requestedById: { in: userIds } },
          { timeLog: { taskId: { in: taskIds } } },
          { timeLog: { userId: { in: userIds } } },
        ],
      },
    }),
  );

  await step("task time logs", () =>
    prisma.taskTimeLog.deleteMany({
      where: { OR: [{ userId: { in: userIds } }, { taskId: { in: taskIds } }] },
    }),
  );

  await step("task notes", () =>
    prisma.taskNote.deleteMany({
      where: { OR: [{ addedById: { in: userIds } }, { taskId: { in: taskIds } }] },
    }),
  );

  // A running timer points at a user from the task itself, so it is cleared
  // rather than deleted — the task may belong to somebody real.
  await step("active timers cleared", () =>
    prisma.task.updateMany({
      where: { activeTimerUserId: { in: userIds } },
      data: { activeTimerUserId: null, activeTimerStartedAt: null },
    }),
  );

  // Children before parents: a recurring instance points at its parent.
  await step("recurring task instances", () =>
    prisma.task.deleteMany({
      where: { AND: [taskWhere, { parentTaskId: { not: null } }] },
    }),
  );

  await step("tasks", () => prisma.task.deleteMany({ where: taskWhere }));

  /* ---------------------------- todos ---------------------------------- */

  const todoWhere = {
    OR: [
      { assignedToId: { in: userIds } },
      { createdById: { in: userIds } },
      { subAssignedToId: { in: userIds } },
    ],
  };

  const todoIds = (
    await prisma.todo.findMany({ where: todoWhere, select: { id: true } })
  ).map((todo) => todo.id);

  await step("todo notes", () =>
    prisma.todoNote.deleteMany({
      where: { OR: [{ addedById: { in: userIds } }, { todoId: { in: todoIds } }] },
    }),
  );

  await step("recurring todo instances", () =>
    prisma.todo.deleteMany({
      where: { AND: [todoWhere, { parentTodoId: { not: null } }] },
    }),
  );

  await step("todos", () => prisma.todo.deleteMany({ where: todoWhere }));

  await step("time blocks", () =>
    prisma.timeBlock.deleteMany({ where: { userId: { in: userIds } } }),
  );

  /* ------------------------------ AR ------------------------------------ */

  await step("AR work notes", () =>
    prisma.arWorkNote.deleteMany({ where: { workedById: { in: userIds } } }),
  );

  // Claims cascade from their batch; a batch uploaded by a fixture user goes
  // whether or not its practice matched.
  await step("AR batches (claims cascade)", () =>
    prisma.arBatch.deleteMany({
      where: {
        OR: [{ uploadedById: { in: userIds } }, { practiceId: { in: practiceIds } }],
      },
    }),
  );

  /* ------------------------------ EOB ----------------------------------- */

  await step("EOB work notes", () =>
    prisma.eobWorkNote.deleteMany({ where: { workedById: { in: userIds } } }),
  );

  await step("EOB batches (entries cascade)", () =>
    prisma.eobBatch.deleteMany({
      where: {
        OR: [{ postedById: { in: userIds } }, { practiceId: { in: practiceIds } }],
      },
    }),
  );

  /* --------------------------- everything else -------------------------- */

  await step("tracker entries", () =>
    prisma.trackerEntry.deleteMany({
      where: {
        OR: [{ enteredById: { in: userIds } }, { practiceId: { in: practiceIds } }],
      },
    }),
  );

  await step("practice requirements", () =>
    prisma.practiceRequirement.deleteMany({
      where: {
        OR: [{ createdById: { in: userIds } }, { practiceId: { in: practiceIds } }],
      },
    }),
  );

  await step("analytics flag dismissals", () =>
    prisma.analyticsFlagDismissal.deleteMany({
      where: { dismissedById: { in: userIds } },
    }),
  );

  await step("practice memberships", () =>
    prisma.userPractice.deleteMany({
      where: {
        OR: [{ userId: { in: userIds } }, { practiceId: { in: practiceIds } }],
      },
    }),
  );

  // A practice pointing at a fixture PM must let go before the user can.
  await step("primary PM references cleared", () =>
    prisma.practice.updateMany({
      where: { primaryPmId: { in: userIds } },
      data: { primaryPmId: null },
    }),
  );

  await step("practices (providers cascade)", () =>
    prisma.practice.deleteMany({ where: { id: { in: practiceIds } } }),
  );

  await step("users", () =>
    prisma.user.deleteMany({ where: { id: { in: userIds } } }),
  );

  const after = await tally();

  console.log("\nBefore → after:");
  for (const [table, count] of Object.entries(before)) {
    const remaining = after[table as keyof typeof after];
    console.log(
      `  ${table.padEnd(16)} ${String(count).padStart(4)} → ${String(remaining).padStart(4)}` +
        (remaining === 0 ? "" : "   ← still present"),
    );
  }

  const clean = Object.values(after).every((count) => count === 0);
  console.log(clean ? "\nClean." : "\nSomething survived — see above.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
