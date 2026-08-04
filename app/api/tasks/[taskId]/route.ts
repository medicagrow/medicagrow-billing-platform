import { NextResponse, type NextRequest } from "next/server";
import { Role, TaskStatus } from "@/lib/generated/prisma/enums";
import {
  apiErrorResponse,
  requireAuth,
  requireRole,
  zodErrorResponse,
} from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import {
  canAssignTask,
  canEditTask,
  taskVisibilityFilter,
} from "@/lib/task-access";
import { TASK_DETAIL_INCLUDE, toTaskDto } from "@/lib/task-serialize";
import { formatMinutes } from "@/lib/task-timer-serialize";
import {
  closeSeries,
  createNextInstance,
  deleteTasks,
  generateFirstInstance,
  taskIdsForDeletion,
} from "@/lib/task/recurrence";
import { dayStart } from "@/lib/todo/access";
import { deleteTaskSchema, updateTaskSchema } from "@/lib/validations/task";

/** Human-readable status names for the automatic note. */
const STATUS_LABELS: Record<TaskStatus, string> = {
  OPEN: "Open",
  IN_PROCESS: "In Process",
  HOLD: "Hold",
  CLOSED: "Closed",
};

export async function GET(
  _request: NextRequest,
  { params }: { params: { taskId: string } },
) {
  const session = await getSession();

  const denied = requireAuth(session);
  if (denied) return denied;

  /**
   * Reading follows the list's visibility rules, not the edit rules — a PM
   * needs to open the series template behind an occurrence they oversee, and
   * that template is rarely assigned to or created by them.
   */
  const task = await prisma.task.findFirst({
    where: {
      AND: [await taskVisibilityFilter(session!.user), { id: params.taskId }],
    },
    include: TASK_DETAIL_INCLUDE,
  });

  if (!task) {
    return apiErrorResponse("Task not found.", 404);
  }

  return NextResponse.json({ task: toTaskDto(task) });
}

/** PATCH /api/tasks/[taskId] — the assignee or the creator may edit. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { taskId: string } },
) {
  const session = await getSession();

  const denied = requireAuth(session);
  if (denied) return denied;

  const body = updateTaskSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!body.success) {
    return zodErrorResponse(body.error);
  }

  const input = body.data;

  const existing = await prisma.task.findUnique({
    where: { id: params.taskId },
    select: {
      id: true,
      assignedToId: true,
      createdById: true,
      status: true,
      holdReleaseDate: true,
      isRecurring: true,
      parentTaskId: true,
      totalLoggedMinutes: true,
    },
  });

  if (!existing) {
    return apiErrorResponse("Task not found.", 404);
  }

  /**
   * The assignee, the creator and Owners may edit. A PM may too, but only
   * within their own practices — they manage the work without holding it, and
   * requiring them to be the assignee would mean reassigning a task to
   * themselves to correct its due date.
   */
  const editable =
    canEditTask(session!.user, existing) ||
    (session!.user.role === Role.PROJECT_MANAGER &&
      (await prisma.task.findFirst({
        where: {
          AND: [await taskVisibilityFilter(session!.user), { id: existing.id }],
        },
        select: { id: true },
      })) !== null);

  if (!editable) {
    return apiErrorResponse("Task not found.", 404);
  }

  if (input.assignedToId && input.assignedToId !== existing.assignedToId) {
    if (!(await canAssignTask(session!.user, input.assignedToId))) {
      return apiErrorResponse("You cannot assign tasks to that person.", 403);
    }
  }

  // Holding a task requires a release date, whether it arrives with this
  // request or was already on the record.
  if (
    input.status === TaskStatus.HOLD &&
    !input.holdReleaseDate &&
    !existing.holdReleaseDate
  ) {
    return apiErrorResponse(
      "Putting a task on hold requires a release date.",
      400,
    );
  }

  const closing =
    input.status === TaskStatus.CLOSED && existing.status !== TaskStatus.CLOSED;

  /**
   * A biller cannot close work they never timed.
   *
   * Efficiency is measured against logged time, so a task closed with an empty
   * timer is a hole in the record. PMs and Owners are exempt: they close tasks
   * they manage but did not personally work, and blocking that would leave the
   * task open instead of getting the time logged.
   */
  if (
    closing &&
    session!.user.role === Role.BILLER &&
    existing.totalLoggedMinutes === 0
  ) {
    return apiErrorResponse("Timer entry required before closing", 400);
  }

  const data: Record<string, unknown> = {};
  if (input.title !== undefined) data.title = input.title;
  if (input.description !== undefined) {
    data.description = input.description ?? null;
  }
  if (input.practiceId !== undefined) data.practiceId = input.practiceId ?? null;
  if (input.taskTypeId !== undefined) data.taskTypeId = input.taskTypeId ?? null;
  if (input.isRecurring !== undefined) data.isRecurring = input.isRecurring;
  if (input.recurringConfig !== undefined) {
    data.recurringConfig = input.recurringConfig ?? undefined;
  }

  const becomingRecurring =
    input.isRecurring === true && !existing.isRecurring;

  if (input.assignedToId !== undefined) data.assignedToId = input.assignedToId;
  if (input.dueDate !== undefined) {
    data.dueDate = input.dueDate ? dayStart(input.dueDate) : null;
  }

  /**
   * Turning recurrence on converts the task into the series template, and a
   * template is not work: it drops its own due date, which now belongs to the
   * occurrences it generates. Applied after the due-date field so a stale one
   * still in the form cannot put it back.
   */
  if (becomingRecurring) data.dueDate = null;
  /**
   * The estimate is the yardstick efficiency is measured against, so a biller
   * cannot move it — that would let the person being measured set the target.
   * Logging actual time stays theirs.
   */
  if (input.estimatedMinutes !== undefined) {
    if (session!.user.role === Role.BILLER) {
      return apiErrorResponse(
        "Only a project manager or owner can change the time estimate.",
        403,
      );
    }

    data.estimatedMinutes = input.estimatedMinutes;
  }
  if (input.priority !== undefined) data.priority = input.priority;
  if (input.tags !== undefined) data.tags = input.tags;
  if (input.isVisibleToCreator !== undefined) {
    data.isVisibleToCreator = input.isVisibleToCreator;
  }
  if (input.holdReleaseDate !== undefined) {
    data.holdReleaseDate = input.holdReleaseDate
      ? dayStart(input.holdReleaseDate)
      : null;
  }

  const statusChanged =
    input.status !== undefined && input.status !== existing.status;

  if (input.status !== undefined) {
    data.status = input.status;

    if (input.status === TaskStatus.CLOSED) {
      if (existing.status !== TaskStatus.CLOSED) {
        data.completedAt = new Date();
        data.completedById = session!.user.id;
        // Time taken is what the timer recorded, not what anyone remembers.
        data.actualMinutes = existing.totalLoggedMinutes;
      }
    } else {
      // Re-opening clears the completion so productivity counts stay honest.
      data.completedAt = null;
      data.completedById = null;
    }

    // Leaving hold drops the release date; it no longer means anything.
    if (input.status !== TaskStatus.HOLD && input.holdReleaseDate === undefined) {
      data.holdReleaseDate = null;
    }
  }

  const task = await prisma.task.update({
    where: { id: params.taskId },
    data,
    include: TASK_DETAIL_INCLUDE,
  });

  // Every status change is recorded, with the caller's note when they wrote
  // one — the note log is how a task's history is read back.
  if (statusChanged || input.note) {
    const label = statusChanged
      ? `Status changed to ${STATUS_LABELS[input.status as TaskStatus]}`
      : null;

    await prisma.taskNote.create({
      data: {
        taskId: task.id,
        note: [label, input.note].filter(Boolean).join(" — "),
        statusChangedTo: statusChanged ? (input.status as TaskStatus) : null,
        addedById: session!.user.id,
      },
    });
  }

  // Time actually spent is worth its own line in the log — that is where
  // anyone comparing it against the estimate will look.
  if (closing) {
    await prisma.taskNote.create({
      data: {
        taskId: task.id,
        note:
          existing.totalLoggedMinutes > 0
            ? `Completed in ${formatMinutes(existing.totalLoggedMinutes)} (from timer logs)`
            : "Completed with no time logged",
        addedById: session!.user.id,
      },
    });
  }

  let nextInstanceId: string | null = null;
  let closedInstances = 0;

  // A series that exists but has produced nothing looks broken, so the first
  // occurrence is written now — exactly as creating a recurring task does.
  if (becomingRecurring) {
    const first = await generateFirstInstance(task);
    nextInstanceId = first?.id ?? null;
  }

  const justClosed =
    statusChanged && input.status === TaskStatus.CLOSED;

  if (justClosed) {
    if (existing.parentTaskId) {
      // Completing an occurrence tops the series up by one, so it never
      // runs dry.
      const parent = await prisma.task.findUnique({
        where: { id: existing.parentTaskId },
      });

      if (parent) {
        const next = await createNextInstance(parent);
        nextInstanceId = next?.id ?? null;
      }
    } else if (existing.isRecurring) {
      // Closing the parent ends the schedule, so nothing it generated should
      // stay open waiting for work that will never be asked for again.
      closedInstances = await closeSeries(task.id, session!.user.id);
    }
  }

  const refreshed = await prisma.task.findUnique({
    where: { id: task.id },
    include: TASK_DETAIL_INCLUDE,
  });

  return NextResponse.json({
    task: toTaskDto(refreshed ?? task),
    nextInstanceId,
    closedInstances,
  });
}

/**
 * DELETE /api/tasks/[taskId] — remove a task, or part of a recurring series.
 *
 * Managers only. A biller closing work they did not need is a status change,
 * not a deletion — removing the row would take its notes and logged time with
 * it, and that is somebody's record of their day.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { taskId: string } },
) {
  const session = await getSession();

  const denied = requireRole(session, [Role.OWNER, Role.PROJECT_MANAGER]);
  if (denied) return denied;

  const body = deleteTaskSchema.safeParse(
    await request.json().catch(() => ({})),
  );

  if (!body.success) {
    return zodErrorResponse(body.error);
  }

  const task = await prisma.task.findUnique({
    where: { id: params.taskId },
    select: {
      id: true,
      isRecurring: true,
      parentTaskId: true,
      dueDate: true,
      practiceId: true,
      assignedToId: true,
      createdById: true,
    },
  });

  if (!task) {
    return apiErrorResponse("Task not found.", 404);
  }

  // A PM may only delete what they can see, which is the practice's work —
  // the same rule the list applies, asked of one row.
  const visible = await prisma.task.findFirst({
    where: {
      AND: [await taskVisibilityFilter(session!.user), { id: task.id }],
    },
    select: { id: true },
  });

  if (!visible) {
    return apiErrorResponse("Task not found.", 404);
  }

  const ids = await taskIdsForDeletion(task, body.data.scope);
  const deleted = await deleteTasks(ids);

  return NextResponse.json({ deleted });
}
