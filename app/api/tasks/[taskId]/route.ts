import { NextResponse, type NextRequest } from "next/server";
import { Role, TaskStatus } from "@/lib/generated/prisma/enums";
import {
  apiErrorResponse,
  requireAuth,
  zodErrorResponse,
} from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canAssignTask, canEditTask } from "@/lib/task-access";
import { TASK_DETAIL_INCLUDE, toTaskDto } from "@/lib/task-serialize";
import { closeSeries, createNextInstance } from "@/lib/task/recurrence";
import { dayStart } from "@/lib/todo/access";
import { updateTaskSchema } from "@/lib/validations/task";

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

  const task = await prisma.task.findUnique({
    where: { id: params.taskId },
    include: TASK_DETAIL_INCLUDE,
  });

  if (!task || !canEditTask(session!.user, task)) {
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
    },
  });

  if (!existing || !canEditTask(session!.user, existing)) {
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

  const data: Record<string, unknown> = {};
  if (input.title !== undefined) data.title = input.title;
  if (input.description !== undefined) {
    data.description = input.description ?? null;
  }
  if (input.practiceId !== undefined) data.practiceId = input.practiceId ?? null;
  if (input.taskTypeId !== undefined) data.taskTypeId = input.taskTypeId ?? null;
  if (input.actualMinutes !== undefined) data.actualMinutes = input.actualMinutes;
  if (input.isRecurring !== undefined) data.isRecurring = input.isRecurring;
  if (input.recurringConfig !== undefined) {
    data.recurringConfig = input.recurringConfig ?? undefined;
  }
  if (input.assignedToId !== undefined) data.assignedToId = input.assignedToId;
  if (input.dueDate !== undefined) {
    data.dueDate = input.dueDate ? dayStart(input.dueDate) : null;
  }
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
  if (
    input.actualMinutes !== undefined &&
    input.actualMinutes !== null &&
    input.status === TaskStatus.CLOSED
  ) {
    await prisma.taskNote.create({
      data: {
        taskId: task.id,
        note: `Completed in ${input.actualMinutes} minutes`,
        addedById: session!.user.id,
      },
    });
  }

  let nextInstanceId: string | null = null;
  let closedInstances = 0;

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
