// ADD-ONLY: this resource is append-only. Do not add PUT, PATCH or DELETE.
// eob_work_notes is the permanent audit trail for denial work.

import { NextResponse, type NextRequest } from "next/server";
import { Role, StatusCategory } from "@/lib/generated/prisma/enums";
import {
  apiErrorResponse,
  requireAuth,
  zodErrorResponse,
} from "@/lib/api-helpers";
import { canAccessPractice } from "@/lib/ar-access";
import { EOB_ENTRY_INCLUDE, toEobEntryDto } from "@/lib/eob-serialize";
import { isResolvingStatus } from "@/lib/eob-status";
import { resolveEscalationTarget } from "@/lib/escalation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { createEobWorkNoteSchema } from "@/lib/validations/eob";

export async function POST(request: NextRequest) {
  const session = await getSession();

  const denied = requireAuth(session);
  if (denied) return denied;

  const body = createEobWorkNoteSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!body.success) {
    return zodErrorResponse(body.error);
  }

  const input = body.data;

  const entry = await prisma.eobEntry.findUnique({
    where: { id: input.entryId },
    select: {
      id: true,
      assignedToId: true,
      batch: { select: { practiceId: true, postedById: true } },
    },
  });

  if (
    !entry ||
    !(await canAccessPractice(session!.user, entry.batch.practiceId))
  ) {
    return apiErrorResponse("Entry not found.", 404);
  }

  // Billers may only work entries assigned to them.
  const isManager =
    session!.user.role === Role.OWNER ||
    session!.user.role === Role.PROJECT_MANAGER;

  if (!isManager && entry.assignedToId !== session!.user.id) {
    return apiErrorResponse("This entry is not assigned to you.", 403);
  }

  /**
   * Blue hands the entry to whoever owns the practice relationship — its
   * primary PM, else whoever posted the batch, else an owner. The same chain
   * AR uses, from the same resolver.
   */
  const goesBlue = input.statusCategoryChangedTo === StatusCategory.BLUE;
  const explicitAssignee =
    input.assignedToChangedId === undefined ? null : input.assignedToChangedId;

  const escalation = goesBlue
    ? await resolveEscalationTarget({
        practiceId: entry.batch.practiceId,
        batchOwnerId: entry.batch.postedById,
      })
    : null;

  // With nobody to escalate to, the entry keeps its current assignee rather
  // than being orphaned.
  const nextAssigneeId = goesBlue
    ? (escalation?.userId ?? entry.assignedToId)
    : (explicitAssignee ?? entry.assignedToId);

  const assignmentChanged = nextAssigneeId !== entry.assignedToId;

  const resolving = isResolvingStatus(input.statusChangedTo);

  const [, updated] = await prisma.$transaction([
    prisma.eobWorkNote.create({
      data: {
        entryId: entry.id,
        note: input.note,
        statusChangedTo: input.statusChangedTo,
        statusCategoryChangedTo: input.statusCategoryChangedTo,
        assignedToChangedId: assignmentChanged ? nextAssigneeId : null,
        workedById: session!.user.id,
      },
    }),
    prisma.eobEntry.update({
      where: { id: entry.id },
      data: {
        statusLabel: input.statusChangedTo,
        statusCategory: input.statusCategoryChangedTo,
        assignedToId: nextAssigneeId,
        ...(resolving
          ? {
              resolvedAt: new Date(),
              resolvedById: session!.user.id,
              ...(input.resolutionNote
                ? { resolutionNote: input.resolutionNote }
                : {}),
            }
          : // Re-opening clears the resolution so "days to resolve" stays honest.
            { resolvedAt: null, resolvedById: null }),
      },
      include: EOB_ENTRY_INCLUDE,
    }),
  ]);

  let reassignedToName: string | null = null;

  if (goesBlue && assignmentChanged && nextAssigneeId) {
    const pm = await prisma.user.findUnique({
      where: { id: nextAssigneeId },
      select: { name: true },
    });
    reassignedToName = pm?.name ?? null;
  }

  return NextResponse.json(
    {
      entry: toEobEntryDto(updated),
      reassignedTo: reassignedToName,
      resolved: resolving,
    },
    { status: 201 },
  );
}
