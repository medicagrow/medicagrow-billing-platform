import { TaskStatus, TodoStatus } from "@/lib/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { dayEnd, dayStart } from "@/lib/todo/access";

/**
 * Returns held work to the open list once its release date arrives.
 *
 * There is no scheduler in this deployment, so this runs at the entry points
 * people actually hit — the My Day and My Tasks queues and the dashboard fetch.
 * That makes the release lazy but reliable: nobody can look at a list without
 * it having been brought up to date first.
 *
 * Each release appends a note, so the history explains why the item moved.
 */
export interface HoldReleaseResult {
  todos: number;
  tasks: number;
}

export async function checkHoldReleases(
  /** Restricts the sweep to one person's work; omit for everything. */
  userId?: string,
): Promise<HoldReleaseResult> {
  const today = dayStart();
  // A release date of "today" means today, so the whole day is included.
  const cutoff = dayEnd(today);

  const assignee = userId ? { assignedToId: userId } : {};

  const [heldTodos, heldTasks] = await Promise.all([
    prisma.todo.findMany({
      where: {
        status: TodoStatus.HOLD,
        holdReleaseDate: { not: null, lte: cutoff },
        ...assignee,
      },
      select: { id: true, assignedToId: true },
    }),
    prisma.task.findMany({
      where: {
        status: TaskStatus.HOLD,
        holdReleaseDate: { not: null, lte: cutoff },
        ...assignee,
      },
      select: { id: true, assignedToId: true },
    }),
  ]);

  if (heldTodos.length === 0 && heldTasks.length === 0) {
    return { todos: 0, tasks: 0 };
  }

  const releasedOn = today.toISOString().slice(0, 10);
  const note = `Auto-released from Hold on ${releasedOn}`;

  await prisma.$transaction([
    ...(heldTodos.length > 0
      ? [
          prisma.todo.updateMany({
            where: { id: { in: heldTodos.map((todo) => todo.id) } },
            data: { status: TodoStatus.OPEN, holdReleaseDate: null },
          }),
          prisma.todoNote.createMany({
            data: heldTodos.map((todo) => ({
              todoId: todo.id,
              note,
              // The release is the system's doing; it is attributed to the
              // assignee because there is no system user to attribute it to.
              addedById: todo.assignedToId,
            })),
          }),
        ]
      : []),
    ...(heldTasks.length > 0
      ? [
          prisma.task.updateMany({
            where: { id: { in: heldTasks.map((task) => task.id) } },
            data: { status: TaskStatus.OPEN, holdReleaseDate: null },
          }),
          prisma.taskNote.createMany({
            data: heldTasks.map((task) => ({
              taskId: task.id,
              note,
              statusChangedTo: TaskStatus.OPEN,
              addedById: task.assignedToId,
            })),
          }),
        ]
      : []),
  ]);

  return { todos: heldTodos.length, tasks: heldTasks.length };
}
