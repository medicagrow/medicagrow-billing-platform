/**
 * PM task scoping: a project manager sees their practices' work, not
 * everything a shared biller happens to touch.
 *
 *   npx tsx scripts/test-task-scoping.ts
 *
 * Runs the filters the routes run — `taskVisibilityFilter()` is what
 * `GET /api/tasks` puts in its `where`, and `teamTaskScope()` is what the Team
 * page counts with — against real rows, rather than going through HTTP. No dev
 * server needed, and a failure points at the filter rather than the transport.
 *
 * Creates ZZ-prefixed rows and removes them at the end.
 */

import { PrismaClient } from "../lib/generated/prisma/client";
import { EhrSource, Role, TaskStatus } from "../lib/generated/prisma/enums";
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

const stamp = Date.now();

async function main() {
  const { taskVisibilityFilter, teamTaskScope } = await import(
    "../lib/task-access"
  );

  const owner = await prisma.user.findFirst({ where: { role: Role.OWNER } });
  if (!owner) throw new Error("no owner user to attribute test rows to");

  /* ------------------------------ fixtures ----------------------------- */

  const practiceA = await prisma.practice.create({
    data: { name: "ZZ Scoping Practice A", ehrSource: EhrSource.OPEN_PM },
  });
  const practiceB = await prisma.practice.create({
    data: { name: "ZZ Scoping Practice B", ehrSource: EhrSource.OPEN_PM },
  });

  const pm = await prisma.user.create({
    data: {
      name: "ZZ Scoping PM",
      email: `zz-scoping-pm-${stamp}@example.test`,
      hashedPassword: "not-a-real-hash",
      role: Role.PROJECT_MANAGER,
      practices: { create: [{ practiceId: practiceA.id }] },
    },
  });

  // Works both practices — the case that used to leak.
  const biller = await prisma.user.create({
    data: {
      name: "ZZ Scoping Biller",
      email: `zz-scoping-biller-${stamp}@example.test`,
      hashedPassword: "not-a-real-hash",
      role: Role.BILLER,
      practices: {
        create: [{ practiceId: practiceA.id }, { practiceId: practiceB.id }],
      },
    },
  });

  // Belongs to practice B only; the PM shares nothing with them.
  const stranger = await prisma.user.create({
    data: {
      name: "ZZ Scoping Stranger",
      email: `zz-scoping-stranger-${stamp}@example.test`,
      hashedPassword: "not-a-real-hash",
      role: Role.BILLER,
      practices: { create: [{ practiceId: practiceB.id }] },
    },
  });

  const makeTask = (
    title: string,
    practiceId: string | null,
    assignedToId: string,
  ) =>
    prisma.task.create({
      data: {
        title,
        practiceId,
        assignedToId,
        createdById: owner.id,
        status: TaskStatus.OPEN,
      },
    });

  const taskA = await makeTask("ZZ Scoping A task", practiceA.id, biller.id);
  const taskB = await makeTask("ZZ Scoping B task", practiceB.id, biller.id);
  const general = await makeTask("ZZ Scoping general task", null, biller.id);
  const strangerTask = await makeTask(
    "ZZ Scoping stranger task",
    practiceB.id,
    stranger.id,
  );

  const testTaskIds = [taskA.id, taskB.id, general.id, strangerTask.id];

  /** The task list the route would return, narrowed to this test's rows. */
  async function visibleTo(user: { id: string; role: Role }) {
    const rows = await prisma.task.findMany({
      where: {
        AND: [
          await taskVisibilityFilter(user),
          { id: { in: testTaskIds } },
        ],
      },
      select: { id: true },
    });

    return new Set(rows.map((row) => row.id));
  }

  console.log("=== GET /api/tasks as the PM ===");

  const pmSees = await visibleTo(pm);

  check("their own practice's task is visible", pmSees.has(taskA.id));
  check(
    "the other practice's task is not — even sharing the biller",
    !pmSees.has(taskB.id),
  );
  check(
    "a general task held by their biller is visible",
    pmSees.has(general.id),
  );
  check(
    "a task for someone they share no practice with is not",
    !pmSees.has(strangerTask.id),
  );
  check("exactly two of the four", pmSees.size === 2, String(pmSees.size));

  console.log("\n=== the same lists for other roles ===");

  const ownerSees = await visibleTo({ id: owner.id, role: Role.OWNER });
  check("an owner sees all four", ownerSees.size === 4, String(ownerSees.size));

  const billerSees = await visibleTo(biller);
  check(
    "a biller sees the three assigned to them",
    billerSees.size === 3 && !billerSees.has(strangerTask.id),
    String(billerSees.size),
  );

  const strangerSees = await visibleTo(stranger);
  check(
    "and nothing that is not theirs",
    strangerSees.size === 1 && strangerSees.has(strangerTask.id),
    String(strangerSees.size),
  );

  console.log("\n=== the Team page's counts ===");

  const pmScope = teamTaskScope({
    accessiblePracticeIds: [practiceA.id],
    selectedPracticeIds: [],
  });

  const countedForPm = await prisma.task.count({
    where: { AND: [pmScope, { assignedToId: biller.id, id: { in: testTaskIds } }] },
  });
  check(
    "the shared biller counts twice, not three times",
    countedForPm === 2,
    String(countedForPm),
  );

  const ownerScope = teamTaskScope({
    accessiblePracticeIds: null,
    selectedPracticeIds: [],
  });
  const countedForOwner = await prisma.task.count({
    where: {
      AND: [ownerScope, { assignedToId: biller.id, id: { in: testTaskIds } }],
    },
  });
  check(
    "an owner counts all three of theirs",
    countedForOwner === 3,
    String(countedForOwner),
  );

  const narrowed = teamTaskScope({
    accessiblePracticeIds: [practiceA.id],
    selectedPracticeIds: [practiceA.id],
  });
  const countedNarrowed = await prisma.task.count({
    where: {
      AND: [narrowed, { assignedToId: biller.id, id: { in: testTaskIds } }],
    },
  });
  check(
    "picking a practice drops the general task",
    countedNarrowed === 1,
    String(countedNarrowed),
  );

  /* ------------------------------ cleanup ------------------------------ */

  await prisma.taskNote.deleteMany({ where: { taskId: { in: testTaskIds } } });
  await prisma.task.deleteMany({ where: { id: { in: testTaskIds } } });
  await prisma.userPractice.deleteMany({
    where: { userId: { in: [pm.id, biller.id, stranger.id] } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: [pm.id, biller.id, stranger.id] } },
  });
  await prisma.practice.deleteMany({
    where: { id: { in: [practiceA.id, practiceB.id] } },
  });

  const leftover = await prisma.task.count({
    where: { title: { startsWith: "ZZ Scoping" } },
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
