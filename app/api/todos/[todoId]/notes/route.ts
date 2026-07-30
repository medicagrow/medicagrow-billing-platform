import { NextResponse, type NextRequest } from "next/server";
import {
  apiErrorResponse,
  requireAuth,
  zodErrorResponse,
} from "@/lib/api-helpers";
import { canEditTodo } from "@/lib/todo/access";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { addTodoNoteSchema } from "@/lib/validations/todo";

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
    select: { id: true, assignedToId: true, createdById: true },
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
