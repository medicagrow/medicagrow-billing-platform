import { NextResponse, type NextRequest } from "next/server";
import { TaskStatus } from "@/lib/generated/prisma/enums";
import {
  apiErrorResponse,
  requireRole,
  zodErrorResponse,
} from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canAssignTask, taskVisibilityFilter } from "@/lib/task-access";
import { dayStart } from "@/lib/todo/access";
import { updateSeriesSchema } from "@/lib/validations/task";

/**
 * PATCH /api/tasks/[taskId]/series — edit a recurring series.
 *
 * The task id may be the parent or any of its occurrences; both resolve to the
 * same series. Managers only, because the change reaches work that is sitting
 * in other people's queues.
 *
 * The parent is **always** updated — it is the template, and leaving it stale
 * would mean the next occurrence undoes whatever was just corrected. What the
 * scope decides is how far back into the occurrences already generated the
 * change reaches.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { taskId: string } },
) {
  const session = await getSession();

  const denied = requireRole(session, ["OWNER", "PROJECT_MANAGER"]);
  if (denied) return denied;

  const body = updateSeriesSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!body.success) {
    return zodErrorResponse(body.error);
  }

  const input = body.data;

  const task = await prisma.task.findUnique({
    where: { id: params.taskId },
    select: {
      id: true,
      isRecurring: true,
      parentTaskId: true,
      dueDate: true,
    },
  });

  if (!task) {
    return apiErrorResponse("Task not found.", 404);
  }

  // A PM may only reach a series they can see.
  const visible = await prisma.task.findFirst({
    where: { AND: [await taskVisibilityFilter(session!.user), { id: task.id }] },
    select: { id: true },
  });

  if (!visible) {
    return apiErrorResponse("Task not found.", 404);
  }

  const parentId = task.isRecurring ? task.id : task.parentTaskId;

  if (!parentId) {
    return apiErrorResponse("That task is not part of a recurring series.", 400);
  }

  if (!(await canAssignTask(session!.user, input.assignedToId))) {
    return apiErrorResponse("You cannot assign tasks to that person.", 403);
  }

  /** Fields shared by the template and its occurrences. */
  const shared = {
    taskTypeId: input.taskTypeId,
    practiceId: input.practiceId ?? null,
    assignedToId: input.assignedToId,
    description: input.description ?? null,
    ...(input.estimatedMinutes !== undefined
      ? { estimatedMinutes: input.estimatedMinutes }
      : {}),
    ...(input.priority !== undefined ? { priority: input.priority } : {}),
    ...(input.tags !== undefined ? { tags: input.tags }: {}),
  };

  /**
   * Which occurrences move with it.
   *
   * "future" and "this" both leave closed work alone: a completed occurrence
   * is a record of what was actually done, and rewriting its practice or
   * assignee afterwards would make the productivity reports lie. "all" is the
   * deliberate exception, for a series that was misfiled from the start.
   */
  const today = dayStart();

  const childFilter =
    input.scope === "all"
      ? { parentTaskId: parentId }
      : input.scope === "this"
        ? {
            parentTaskId: parentId,
            status: { not: TaskStatus.CLOSED },
            ...(task.dueDate ? { dueDate: { gte: task.dueDate } } : {}),
          }
        : {
            parentTaskId: parentId,
            status: { not: TaskStatus.CLOSED },
            dueDate: { gt: today },
          };

  const [, updatedChildren] = await prisma.$transaction([
    prisma.task.update({
      where: { id: parentId },
      data: {
        ...shared,
        ...(input.recurringConfig
          ? { recurringConfig: input.recurringConfig }
          : {}),
      },
    }),
    prisma.task.updateMany({ where: childFilter, data: shared }),
  ]);

  return NextResponse.json({
    parentId,
    updatedInstances: updatedChildren.count,
  });
}
