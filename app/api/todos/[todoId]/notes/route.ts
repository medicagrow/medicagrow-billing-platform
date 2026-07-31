// ADD-ONLY: this resource is append-only. Do not add PUT, PATCH or DELETE.
import { NextResponse, type NextRequest } from "next/server";
import {
  apiErrorResponse,
  paginatedResponse,
  parsePagination,
  requireAuth,
  zodErrorResponse,
} from "@/lib/api-helpers";
import { canEditTodo } from "@/lib/todo/access";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { addTodoNoteSchema } from "@/lib/validations/todo";

/**
 * GET /api/todos/[todoId]/notes — the note log, newest first.
 *
 * The edit panel reloads from here after every save. Without it the panel's
 * fetch 405s, the failure is swallowed by an `if (response.ok)`, and adding a
 * note looks like it did nothing even though the note was written.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { todoId: string } },
) {
  const session = await getSession();

  const denied = requireAuth(session);
  if (denied) return denied;

  const todo = await prisma.todo.findUnique({
    where: { id: params.todoId },
    select: {
      id: true,
      assignedToId: true,
      subAssignedToId: true,
      createdById: true,
    },
  });

  if (!todo || !canEditTodo(session!.user, todo)) {
    return apiErrorResponse("Task not found.", 404);
  }

  const pagination = parsePagination(request.nextUrl.searchParams);

  const [notes, total] = await Promise.all([
    prisma.todoNote.findMany({
      where: { todoId: todo.id },
      orderBy: { addedAt: "desc" },
      skip: pagination.skip,
      take: pagination.take,
      include: { addedBy: { select: { name: true } } },
    }),
    prisma.todoNote.count({ where: { todoId: todo.id } }),
  ]);

  return paginatedResponse(
    notes.map((note) => ({
      id: note.id,
      note: note.note,
      addedByName: note.addedBy.name,
      addedAt: note.addedAt.toISOString(),
    })),
    total,
    pagination,
  );
}

/** POST /api/todos/[todoId]/notes — append a note to a task. */
export async function POST(
  request: NextRequest,
  { params }: { params: { todoId: string } },
) {
  const session = await getSession();

  const denied = requireAuth(session);
  if (denied) return denied;

  const body = addTodoNoteSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!body.success) {
    return zodErrorResponse(body.error);
  }

  const todo = await prisma.todo.findUnique({
    where: { id: params.todoId },
    select: {
      id: true,
      assignedToId: true,
      subAssignedToId: true,
      createdById: true,
    },
  });

  if (!todo || !canEditTodo(session!.user, todo)) {
    return apiErrorResponse("Task not found.", 404);
  }

  const note = await prisma.todoNote.create({
    data: {
      todoId: todo.id,
      note: body.data.note,
      addedById: session!.user.id,
    },
    include: { addedBy: { select: { name: true } } },
  });

  return NextResponse.json(
    {
      note: {
        id: note.id,
        note: note.note,
        addedByName: note.addedBy.name,
        addedAt: note.addedAt.toISOString(),
      },
    },
    { status: 201 },
  );
}
