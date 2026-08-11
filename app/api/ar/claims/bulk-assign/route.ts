import { NextResponse, type NextRequest } from "next/server";
import { BatchStatus, Role } from "@/lib/generated/prisma/enums";
import { apiErrorResponse, requireRole, zodErrorResponse } from "@/lib/api-helpers";
import { accessiblePracticeIds } from "@/lib/ar-access";
import { isNotActionable, NOT_ACTIONABLE_MAX_DAYS } from "@/lib/ar-actionable";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { bulkAssignSchema } from "@/lib/validations/ar";

const MAX_BULK_CLAIMS = 5000;

export async function POST(request: NextRequest) {
  const session = await getSession();

  const denied = requireRole(session, [Role.OWNER, Role.PROJECT_MANAGER]);
  if (denied) return denied;

  const body = bulkAssignSchema.safeParse(await request.json().catch(() => null));

  if (!body.success) {
    return zodErrorResponse(body.error);
  }

  const { claimIds, assignedToId, includeNotActionable } = body.data;

  if (claimIds.length > MAX_BULK_CLAIMS) {
    return apiErrorResponse(
      `Too many claims in one request (${claimIds.length}). The limit is ${MAX_BULK_CLAIMS}.`,
      400,
    );
  }

  if (assignedToId) {
    const assignee = await prisma.user.findUnique({
      where: { id: assignedToId },
      select: { id: true, isActive: true },
    });

    if (!assignee || !assignee.isActive) {
      return apiErrorResponse("That user cannot be assigned claims.", 400);
    }
  }

  const claims = await prisma.arClaim.findMany({
    where: { id: { in: claimIds } },
    select: {
      id: true,
      batchId: true,
      agingDays: true,
      batch: { select: { status: true, practiceId: true } },
    },
  });

  if (claims.length === 0) {
    return apiErrorResponse("No matching claims found.", 404);
  }

  /**
   * Every affected batch must be open and within the caller's practices.
   *
   * The practice ids come back with the claims, so this is one lookup of what
   * the caller may reach rather than two queries per distinct batch, awaited
   * one after another.
   */
  const accessible = await accessiblePracticeIds(session!.user);

  if (accessible !== null) {
    const allowed = new Set(accessible);

    if (claims.some((claim) => !allowed.has(claim.batch.practiceId))) {
      return apiErrorResponse(
        "One or more claims belong to a practice you cannot access.",
        403,
      );
    }
  }

  if (claims.some((claim) => claim.batch.status === BatchStatus.CLOSED)) {
    return apiErrorResponse(
      "One or more claims belong to a closed batch, which is read-only.",
      403,
    );
  }

  /**
   * 0–30 day claims are dropped from the assignment unless the PM asked for
   * them. They stay selectable in the list — hiding them would make the batch
   * unreadable — so the rule lives here, and the response says how many it
   * skipped rather than silently doing less than was asked.
   *
   * Unassigning is exempt: taking work *back* off a biller is never premature.
   */
  const skipped =
    includeNotActionable || assignedToId === null
      ? []
      : claims.filter((claim) => isNotActionable(claim));

  const skippedIds = new Set(skipped.map((claim) => claim.id));
  const assignable = claims.filter((claim) => !skippedIds.has(claim.id));

  if (assignable.length === 0) {
    return apiErrorResponse(
      `Every selected claim is in the 0–${NOT_ACTIONABLE_MAX_DAYS} day bucket and not yet actionable. Tick "Include 0–${NOT_ACTIONABLE_MAX_DAYS} day claims" to assign them anyway.`,
      400,
    );
  }

  const result = await prisma.arClaim.updateMany({
    where: { id: { in: assignable.map((claim) => claim.id) } },
    data: { assignedToId },
  });

  return NextResponse.json({ updated: result.count, skipped: skipped.length });
}
