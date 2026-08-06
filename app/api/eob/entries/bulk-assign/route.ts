import { NextResponse, type NextRequest } from "next/server";
import { Role } from "@/lib/generated/prisma/enums";
import {
  apiErrorResponse,
  requireRole,
  zodErrorResponse,
} from "@/lib/api-helpers";
import { accessiblePracticeIds } from "@/lib/ar-access";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { bulkAssignEobSchema } from "@/lib/validations/eob";

const MAX_BULK_ENTRIES = 5000;

export async function POST(request: NextRequest) {
  const session = await getSession();

  const denied = requireRole(session, [Role.OWNER, Role.PROJECT_MANAGER]);
  if (denied) return denied;

  const body = bulkAssignEobSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!body.success) {
    return zodErrorResponse(body.error);
  }

  const { entryIds, assignedToId } = body.data;

  if (entryIds.length > MAX_BULK_ENTRIES) {
    return apiErrorResponse(
      `Too many entries in one request (${entryIds.length}). The limit is ${MAX_BULK_ENTRIES}.`,
      400,
    );
  }

  if (assignedToId) {
    const assignee = await prisma.user.findUnique({
      where: { id: assignedToId },
      select: { id: true, isActive: true },
    });

    if (!assignee || !assignee.isActive) {
      return apiErrorResponse("That user cannot be assigned entries.", 400);
    }
  }

  const entries = await prisma.eobEntry.findMany({
    where: { id: { in: entryIds } },
    select: { id: true, batch: { select: { practiceId: true } } },
  });

  if (entries.length === 0) {
    return apiErrorResponse("No matching entries found.", 404);
  }

  /**
   * Every affected practice must be one the caller can reach — checked once
   * against the caller's practice list rather than once per distinct
   * practice, awaited one after another.
   */
  const accessible = await accessiblePracticeIds(session!.user);

  if (accessible !== null) {
    const allowed = new Set(accessible);

    if (entries.some((entry) => !allowed.has(entry.batch.practiceId))) {
      return apiErrorResponse(
        "One or more entries belong to a practice you cannot access.",
        403,
      );
    }
  }

  const result = await prisma.eobEntry.updateMany({
    where: { id: { in: entries.map((entry) => entry.id) } },
    data: { assignedToId },
  });

  return NextResponse.json({ updated: result.count });
}
