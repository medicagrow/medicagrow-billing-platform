import { NextResponse, type NextRequest } from "next/server";
import { TodoStatus } from "@/lib/generated/prisma/enums";
import {
  apiErrorResponse,
  requireAuth,
  zodErrorResponse,
} from "@/lib/api-helpers";
import { TODO_INCLUDE, toTodoDto } from "@/lib/todo-serialize";
import { canAssignTo, canEditTodo, dayStart } from "@/lib/todo/access";
import {
  generateNextInstance,
  parseRecurringConfig,
} from "@/lib/todo/recurrence";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { updateTodoSchema } from "@/lib/validations/todo";

/** Human-readable status names for the automatic note. */
const STATUS_LABELS: Record<TodoStatus, string> = {
  OPEN: "Open",
  IN_PROCESS: "In Process",
  HOLD: "Hold",
  CLOSED: "Closed",
};

export async function PATCH(
  request: NextRequest,
  { params }: { params: { todoId: string } },
) {
  const session = await getSession();

  const denied = requireAuth(session);
  if (denied) return denied;

  const body = updateTodoSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!body.success) {
    return zodErrorResponse(body.error);
  }

  const input = body.data;

  const existing = await prisma.todo.findUnique({
    where: { id: params.todoId },
    select: {
      id: true,
      assignedToId: true,
      subAssignedToId: true,
      createdById: true,
      status: true,
      dueDate: true,
      title: true,
      description: true,
      practiceId: true,
      estimatedMinutes: true,
      priority: true,
      tags: true,
      holdReleaseDate: true,
      isRecurring: true,
      recurringConfig: true,
      parentTodoId: true,
    },
  });

  if (!existing || !canEditTodo(session!.user, existing)) {
    return apiErrorResponse("Task not found.", 404);
  }

  if (input.assignedToId && input.assignedToId !== existing.assignedToId) {
    if (!(await canAssignTo(session!.user, input.assignedToId))) {
      return apiErrorResponse("You cannot assign tasks to that person.", 403);
    }
  }

  // Sub-assignment is delegation, so it answers to the same rule as assigning.
  if (
    input.subAssignedToId &&
    input.subAssignedToId !== existing.subAssignedToId &&
    !(await canAssignTo(session!.user, input.subAssignedToId))
  ) {
    return apiErrorResponse("You cannot sub-assign to that person.", 403);
  }

  const completing =
    input.status === TodoStatus.CLOSED && existing.status !== TodoStatus.CLOSED;

  const data: Record<string, unknown> = {};
  if (input.title !== undefined) data.title = input.title;
  if (input.description !== undefined) data.description = input.description ?? null;
  if (input.practiceId !== undefined) data.practiceId = input.practiceId ?? null;
  if (input.assignedToId !== undefined) data.assignedToId = input.assignedToId;
  if (input.dueDate !== undefined) {
    data.dueDate = input.dueDate ? dayStart(input.dueDate) : null;
  }
  if (input.estimatedMinutes !== undefined) {
    data.estimatedMinutes = input.estimatedMinutes;
  }
  if (input.priority !== undefined) data.priority = input.priority;
  if (input.tags !== undefined) data.tags = input.tags;
  if (input.isShared !== undefined) data.isShared = input.isShared;
  if (input.subAssignedToId !== undefined) {
    data.subAssignedToId = input.subAssignedToId;
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

    if (completing) {
      data.completedAt = new Date();
      data.completedById = session!.user.id;
    } else if (input.status !== TodoStatus.CLOSED) {
      // Re-opening clears the completion so productivity counts stay honest.
      data.completedAt = null;
      data.completedById = null;
    }

    // Leaving hold drops the release date; it no longer means anything.
    if (
      input.status !== TodoStatus.HOLD &&
      input.holdReleaseDate === undefined
    ) {
      data.holdReleaseDate = null;
    }
  }

  const todo = await prisma.todo.update({
    where: { id: params.todoId },
    data,
    include: TODO_INCLUDE,
  });

  // Every status change is recorded, with the caller's note when they wrote
  // one — the note log is how a to do's history is read back.
  const narration = input.note ?? input.deferNote;

  if (statusChanged || narration) {
    const label = statusChanged
      ? `Status changed to ${STATUS_LABELS[input.status as TodoStatus]}`
      : null;

    await prisma.todoNote.create({
      data: {
        todoId: todo.id,
        note: [label, narration].filter(Boolean).join(" — "),
        addedById: session!.user.id,
      },
    });
  }

  // Completing an instance tops the series up by one, so it never runs dry.
  let nextInstanceId: string | null = null;

  if (completing) {
    const templateId = existing.parentTodoId ?? existing.id;

    const template = await prisma.todo.findUnique({
      where: { id: templateId },
      select: {
        id: true,
        isRecurring: true,
        recurringConfig: true,
        title: true,
        description: true,
        practiceId: true,
        assignedToId: true,
        estimatedMinutes: true,
        priority: true,
        tags: true,
        createdById: true,
      },
    });

    const config = template?.isRecurring
      ? parseRecurringConfig(template.recurringConfig)
      : null;

    if (template && config) {
      const from = existing.dueDate ?? dayStart();
      const next = generateNextInstance(config, from);

      if (next) {
        // Only if that date is not already scheduled.
        const clash = await prisma.todo.findFirst({
          where: {
            OR: [{ parentTodoId: template.id }, { id: template.id }],
            dueDate: next,
          },
          select: { id: true },
        });

        if (!clash) {
          const created = await prisma.todo.create({
            data: {
              title: template.title,
              description: template.description,
              practiceId: template.practiceId,
              createdById: template.createdById,
              assignedToId: template.assignedToId,
              dueDate: next,
              estimatedMinutes: template.estimatedMinutes,
              priority: template.priority,
              tags: template.tags,
              isRecurring: false,
              parentTodoId: template.id,
            },
            select: { id: true },
          });
          nextInstanceId = created.id;
        }
      }
    }
  }

  return NextResponse.json({ todo: toTodoDto(todo), nextInstanceId });
}

/**
 * DELETE /api/todos/[todoId] — soft delete.
 *
 * Tasks are deferred with a note rather than removed: the productivity module
 * reports on completion history, and hard deletes would rewrite it.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { todoId: string } },
) {
  const session = await getSession();

  const denied = requireAuth(session);
  if (denied) return denied;

  const existing = await prisma.todo.findUnique({
    where: { id: params.todoId },
    select: { id: true, assignedToId: true, createdById: true },
  });

  if (!existing || !canEditTodo(session!.user, existing)) {
    return apiErrorResponse("Task not found.", 404);
  }

  const todo = await prisma.todo.update({
    where: { id: params.todoId },
    data: { status: TodoStatus.HOLD },
    include: TODO_INCLUDE,
  });

  await prisma.todoNote.create({
    data: {
      todoId: todo.id,
      note: "Removed from the active list.",
      addedById: session!.user.id,
    },
  });

  return NextResponse.json({ todo: toTodoDto(todo) });
}
