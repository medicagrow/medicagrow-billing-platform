// ADD-ONLY: this resource is append-only. Do not add PUT, PATCH or DELETE.
import { NextResponse, type NextRequest } from "next/server";
import {
  apiErrorResponse,
  paginatedResponse,
  parsePagination,
  requireAuth,
  zodErrorResponse,
} from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canEditTask } from "@/lib/task-access";
import { toTaskNoteDto } from "@/lib/task-serialize";
import { addTaskNoteSchema } from "@/lib/validations/task";

export async function GET(
  request: NextRequest,
  { params }: { params: { taskId: string } },
) {
  const session = await getSession();

  const denied = requireAuth(session);
  if (denied) return denied;

  const task = await prisma.task.findUnique({
    where: { id: params.taskId },
    select: { id: true, assignedToId: true, createdById: true },
  });

  if (!task || !canEditTask(session!.user, task)) {
    return apiErrorResponse("Task not found.", 404);
  }

  const pagination = parsePagination(request.nextUrl.searchParams);

  const [notes, total] = await Promise.all([
    prisma.taskNote.findMany({
      where: { taskId: task.id },
      orderBy: { addedAt: "desc" },
      skip: pagination.skip,
      take: pagination.take,
      include: { addedBy: { select: { name: true } } },
    }),
    prisma.taskNote.count({ where: { taskId: task.id } }),
  ]);

  return paginatedResponse(notes.map(toTaskNoteDto), total, pagination);
}

export async function POST(
  request: NextRequest,
  { params }: { params: { taskId: string } },
) {
  const session = await getSession();

  const denied = requireAuth(session);
  if (denied) return denied;

  const body = addTaskNoteSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!body.success) {
    return zodErrorResponse(body.error);
  }

  const task = await prisma.task.findUnique({
    where: { id: params.taskId },
    select: { id: true, assignedToId: true, createdById: true },
  });

  if (!task || !canEditTask(session!.user, task)) {
    return apiErrorResponse("Task not found.", 404);
  }

  const note = await prisma.taskNote.create({
    data: {
      taskId: task.id,
      note: body.data.note,
      addedById: session!.user.id,
    },
    include: { addedBy: { select: { name: true } } },
  });

  return NextResponse.json({ note: toTaskNoteDto(note) }, { status: 201 });
}
