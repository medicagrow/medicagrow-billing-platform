import { NextResponse, type NextRequest } from "next/server";
import {
  apiErrorResponse,
  requireAuth,
  zodErrorResponse,
} from "@/lib/api-helpers";
import { dayStart } from "@/lib/todo/access";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { updateTimeBlockSchema } from "@/lib/validations/todo";

/** Schedules are personal: only the owner of a block may change it. */
async function loadOwnBlock(blockId: string, userId: string) {
  const block = await prisma.timeBlock.findUnique({
    where: { id: blockId },
    select: { id: true, userId: true },
  });

  return block && block.userId === userId ? block : null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { blockId: string } },
) {
  const session = await getSession();

  const denied = requireAuth(session);
  if (denied) return denied;

  const block = await loadOwnBlock(params.blockId, session!.user.id);
  if (!block) return apiErrorResponse("Time block not found.", 404);

  const body = updateTimeBlockSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!body.success) {
    return zodErrorResponse(body.error);
  }

  const input = body.data;
  const data: Record<string, unknown> = {};

  if (input.dayOfWeek !== undefined) data.dayOfWeek = input.dayOfWeek;
  if (input.specificDate !== undefined) {
    data.specificDate = input.specificDate ? dayStart(input.specificDate) : null;
  }
  if (input.startTime !== undefined) data.startTime = input.startTime;
  if (input.endTime !== undefined) data.endTime = input.endTime;
  if (input.label !== undefined) data.label = input.label;
  if (input.blockType !== undefined) data.blockType = input.blockType;
  if (input.color !== undefined) data.color = input.color ?? null;
  if (input.isActive !== undefined) data.isActive = input.isActive;

  // A partial update can change only one side of the range, so check the
  // resulting pair before writing rather than repairing afterwards.
  const current = await prisma.timeBlock.findUnique({
    where: { id: params.blockId },
    select: { startTime: true, endTime: true },
  });

  const nextStart = input.startTime ?? current!.startTime;
  const nextEnd = input.endTime ?? current!.endTime;

  if (nextStart >= nextEnd) {
    return apiErrorResponse("End time must be after start time.", 400);
  }

  const updated = await prisma.timeBlock.update({
    where: { id: params.blockId },
    data,
  });

  return NextResponse.json({ block: updated });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { blockId: string } },
) {
  const session = await getSession();

  const denied = requireAuth(session);
  if (denied) return denied;

  const block = await loadOwnBlock(params.blockId, session!.user.id);
  if (!block) return apiErrorResponse("Time block not found.", 404);

  await prisma.timeBlock.delete({ where: { id: params.blockId } });

  return NextResponse.json({ deleted: true });
}
