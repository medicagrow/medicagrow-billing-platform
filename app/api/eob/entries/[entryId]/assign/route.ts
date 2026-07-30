import { NextResponse, type NextRequest } from "next/server";
import { Role } from "@/lib/generated/prisma/enums";
import {
  apiErrorResponse,
  requireRole,
  zodErrorResponse,
} from "@/lib/api-helpers";
import { canAccessPractice } from "@/lib/ar-access";
import { EOB_ENTRY_INCLUDE, toEobEntryDto } from "@/lib/eob-serialize";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { assignEobEntrySchema } from "@/lib/validations/eob";

export async function PATCH(
  request: NextRequest,
  { params }: { params: { entryId: string } },
) {
  const session = await getSession();

  const denied = requireRole(session, [Role.OWNER, Role.PROJECT_MANAGER]);
  if (denied) return denied;

  const body = assignEobEntrySchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!body.success) {
    return zodErrorResponse(body.error);
  }

  const entry = await prisma.eobEntry.findUnique({
    where: { id: params.entryId },
    select: { id: true, batch: { select: { practiceId: true } } },
  });

  if (
    !entry ||
    !(await canAccessPractice(session!.user, entry.batch.practiceId))
  ) {
    return apiErrorResponse("Entry not found.", 404);
  }

  if (body.data.assignedToId) {
    const assignee = await prisma.user.findUnique({
      where: { id: body.data.assignedToId },
      select: { id: true, isActive: true },
    });

    if (!assignee || !assignee.isActive) {
      return apiErrorResponse("That user cannot be assigned entries.", 400);
    }
  }

  const updated = await prisma.eobEntry.update({
    where: { id: params.entryId },
    data: { assignedToId: body.data.assignedToId },
    include: EOB_ENTRY_INCLUDE,
  });

  return NextResponse.json({ entry: toEobEntryDto(updated) });
}
