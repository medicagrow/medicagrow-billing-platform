import { NextResponse, type NextRequest } from "next/server";
import { LockStatus, Role } from "@/lib/generated/prisma/enums";
import { apiErrorResponse, requireRole } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

/**
 * PATCH /api/tracker/entries/[entryId]/lock — freeze a month. Owner only.
 * There is no unlock: a locked month is a reported figure, and reopening it
 * would let history change after the fact.
 */
export async function PATCH(
  _request: NextRequest,
  { params }: { params: { entryId: string } },
) {
  const session = await getSession();

  const denied = requireRole(session, [Role.OWNER]);
  if (denied) return denied;

  const existing = await prisma.trackerEntry.findUnique({
    where: { id: params.entryId },
    select: { id: true, lockStatus: true },
  });

  if (!existing) {
    return apiErrorResponse("Entry not found.", 404);
  }

  if (existing.lockStatus === LockStatus.LOCKED) {
    return apiErrorResponse("This entry is already locked.", 409);
  }

  const entry = await prisma.trackerEntry.update({
    where: { id: params.entryId },
    data: {
      lockStatus: LockStatus.LOCKED,
      lockedAt: new Date(),
      lockedById: session!.user.id,
    },
    include: { lockedBy: { select: { name: true } } },
  });

  return NextResponse.json({
    entry: {
      id: entry.id,
      lockStatus: entry.lockStatus,
      lockedAt: entry.lockedAt?.toISOString() ?? null,
      lockedByName: entry.lockedBy?.name ?? null,
    },
  });
}
