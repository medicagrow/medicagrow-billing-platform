import { NextResponse, type NextRequest } from "next/server";
import { BatchStatus, Role } from "@/lib/generated/prisma/enums";
import { apiErrorResponse, requireRole, zodErrorResponse } from "@/lib/api-helpers";
import { canAccessBatch } from "@/lib/ar-access";
import { CLAIM_INCLUDE, toClaimDto } from "@/lib/ar-serialize";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { assignClaimSchema } from "@/lib/validations/ar";

export async function PATCH(
  request: NextRequest,
  { params }: { params: { claimId: string } },
) {
  const session = await getSession();

  const denied = requireRole(session, [Role.OWNER, Role.PROJECT_MANAGER]);
  if (denied) return denied;

  const body = assignClaimSchema.safeParse(await request.json().catch(() => null));

  if (!body.success) {
    return zodErrorResponse(body.error);
  }

  const claim = await prisma.arClaim.findUnique({
    where: { id: params.claimId },
    select: { id: true, batchId: true, batch: { select: { status: true } } },
  });

  if (!claim || !(await canAccessBatch(session!.user, claim.batchId))) {
    return apiErrorResponse("Claim not found.", 404);
  }

  if (claim.batch.status === BatchStatus.CLOSED) {
    return apiErrorResponse(
      "This batch is closed and is read-only.",
      403,
    );
  }

  if (body.data.assignedToId) {
    const assignee = await prisma.user.findUnique({
      where: { id: body.data.assignedToId },
      select: { id: true, isActive: true },
    });

    if (!assignee || !assignee.isActive) {
      return apiErrorResponse("That user cannot be assigned claims.", 400);
    }
  }

  const updated = await prisma.arClaim.update({
    where: { id: params.claimId },
    data: { assignedToId: body.data.assignedToId },
    include: CLAIM_INCLUDE,
  });

  return NextResponse.json({ claim: toClaimDto(updated) });
}
