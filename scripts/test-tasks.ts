/**
 * Task module and hold-release checks.
 *
 *   npx tsx scripts/test-tasks.ts
 *
 * Creates ZZ-prefixed rows and removes them at the end. It never touches
 * real data.
 */

import { PrismaClient, TaskStatus, TodoStatus } from "../lib/generated/prisma/client";
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

async function main() {
  const owner = await prisma.user.findFirst({ where: { role: "OWNER" } });
  if (!owner) throw new Error("no owner user to attribute test rows to");

  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  yesterday.setUTCHours(0, 0, 0, 0);

  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(0, 0, 0, 0);

  // Two held items whose release date has passed, one that has not.
  const [dueTask, futureTask, dueTodo] = await Promise.all([
    prisma.task.create({
      data: {
        title: "ZZ Task hold expired",
        createdById: owner.id,
        assignedToId: owner.id,
        status: TaskStatus.HOLD,
        holdReleaseDate: yesterday,
      },
    }),
    prisma.task.create({
      data: {
        title: "ZZ Task hold pending",
        createdById: owner.id,
        assignedToId: owner.id,
        status: TaskStatus.HOLD,
        holdReleaseDate: tomorrow,
      },
    }),
    prisma.todo.create({
      data: {
        title: "ZZ Todo hold expired",
        createdById: owner.id,
        assignedToId: owner.id,
        status: TodoStatus.HOLD,
        holdReleaseDate: yesterday,
      },
    }),
  ]);

  const { checkHoldReleases } = await import("../lib/todo/hold-release");
  const released = await checkHoldReleases(owner.id);

  check("released at least one task", released.tasks >= 1, String(released.tasks));
  check("released at least one todo", released.todos >= 1, String(released.todos));

  const [after, stillHeld, todoAfter] = await Promise.all([
    prisma.task.findUnique({ where: { id: dueTask.id } }),
    prisma.task.findUnique({ where: { id: futureTask.id } }),
    prisma.todo.findUnique({ where: { id: dueTodo.id } }),
  ]);

  check("expired task is OPEN", after?.status === TaskStatus.OPEN, String(after?.status));
  check("expired task release date cleared", after?.holdReleaseDate === null);
  check("future task stays on HOLD", stillHeld?.status === TaskStatus.HOLD, String(stillHeld?.status));
  check("expired todo is OPEN", todoAfter?.status === TodoStatus.OPEN, String(todoAfter?.status));

  const note = await prisma.taskNote.findFirst({
    where: { taskId: dueTask.id },
    orderBy: { addedAt: "desc" },
  });

  check("release logged a note", note !== null && note.note.startsWith("Auto-released from Hold on"), note?.note ?? "none");
  check("note records the new status", note?.statusChangedTo === TaskStatus.OPEN, String(note?.statusChangedTo));

  // A second sweep must be a no-op — nothing is still eligible.
  const again = await checkHoldReleases(owner.id);
  check("second sweep releases nothing new", again.tasks === 0 && again.todos === 0, `${again.tasks}/${again.todos}`);

  // Cleanup.
  await prisma.taskNote.deleteMany({ where: { taskId: { in: [dueTask.id, futureTask.id] } } });
  await prisma.todoNote.deleteMany({ where: { todoId: dueTodo.id } });
  await prisma.task.deleteMany({ where: { title: { startsWith: "ZZ Task" } } });
  await prisma.todo.deleteMany({ where: { title: { startsWith: "ZZ Todo" } } });

  const leftover = await prisma.task.count({ where: { title: { startsWith: "ZZ " } } });
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
