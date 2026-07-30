import { NextResponse, type NextRequest } from "next/server";
import {
  apiErrorResponse,
  requireRole,
  zodErrorResponse,
} from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { updateTaskTypeSchema } from "@/lib/validations/task-type";

/**
 * PATCH /api/task-types/[taskTypeId] — owner only.
 *
 * There is no DELETE: a type in use is referenced by tasks whose history would
 * lose its meaning. Deactivating hides it from the pickers instead, and the
 * tasks that carry it keep showing the name.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { taskTypeId: string } },
) {
  const session = await getSession();

  const denied = requireRole(session, ["OWNER"]);
  if (denied) return denied;

  const body = updateTaskTypeSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!body.success) {
    return zodErrorResponse(body.error);
  }

  const existing = await prisma.taskType.findUnique({
    where: { id: params.taskTypeId },
    select: { id: true },
  });

  if (!existing) {
    return apiErrorResponse("Task type not found.", 404);
  }

  if (body.data.name) {
    const clash = await prisma.taskType.findFirst({
      where: { name: body.data.name, id: { not: params.taskTypeId } },
      select: { id: true },
    });

    if (clash) {
      return apiErrorResponse(
        "A task type with that name already exists.",
        409,
      );
    }
  }

  const taskType = await prisma.taskType.update({
    where: { id: params.taskTypeId },
    data: body.data,
  });

  return NextResponse.json({ taskType });
}
