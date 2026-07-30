import { NextResponse, type NextRequest } from "next/server";
import { BatchStatus, Role } from "@/lib/generated/prisma/enums";
import { apiErrorResponse, requireRole, zodErrorResponse } from "@/lib/api-helpers";
import { canAccessBatch } from "@/lib/ar-access";
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

  const { claimIds, assignedToId } = body.data;

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
    select: { id: true, batchId: true, batch: { select: { status: true } } },
  });

  if (claims.length === 0) {
    return apiErrorResponse("No matching claims found.", 404);
  }

  // Every affected batch must be open and within the caller's practices.
  const batchIds = Array.from(new Set(claims.map((claim) => claim.batchId)));

  for (const batchId of batchIds) {
    if (!(await canAccessBatch(session!.user, batchId))) {
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

  const result = await prisma.arClaim.updateMany({
    where: { id: { in: claims.map((claim) => claim.id) } },
    data: { assignedToId },
  });

  return NextResponse.json({ updated: result.count });
}
