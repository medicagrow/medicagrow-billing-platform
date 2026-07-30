import { NextResponse, type NextRequest } from "next/server";
import { BatchStatus, Role } from "@/lib/generated/prisma/enums";
import {
  apiErrorResponse,
  requireRole,
  zodErrorResponse,
} from "@/lib/api-helpers";
import { canAccessBatch } from "@/lib/ar-access";
import { calculateAgingDays } from "@/lib/ar-parsers/utils";
import { CLAIM_INCLUDE, toClaimDto } from "@/lib/ar-serialize";
import {
  DEFAULT_STATUS_CATEGORY,
  DEFAULT_STATUS_LABEL,
} from "@/lib/ar-status";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { createClaimSchema } from "@/lib/validations/ar";

/**
 * POST /api/ar/claims/create — add a single claim to an open batch by hand.
 *
 * Lives at /create rather than on the /api/ar/claims collection because that
 * route's GET is the paginated claim list; keeping them separate avoids
 * overloading one path with unrelated read and write semantics.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();

  const denied = requireRole(session, [Role.OWNER, Role.PROJECT_MANAGER]);
  if (denied) return denied;

  const body = createClaimSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!body.success) {
    return zodErrorResponse(body.error);
  }

  const input = body.data;

  const batch = await prisma.arBatch.findUnique({
    where: { id: input.batchId },
    select: { id: true, status: true, practiceId: true },
  });

  if (!batch || !(await canAccessBatch(session!.user, batch.id))) {
    return apiErrorResponse("Batch not found.", 404);
  }

  if (batch.status === BatchStatus.CLOSED) {
    return apiErrorResponse(
      "This batch is closed and is read-only.",
      403,
    );
  }

  if (input.assignedToId) {
    const assignee = await prisma.user.findUnique({
      where: { id: input.assignedToId },
      select: { id: true, isActive: true },
    });

    if (!assignee || !assignee.isActive) {
      return apiErrorResponse("That user cannot be assigned claims.", 400);
    }
  }

  const dateOfService = new Date(`${input.dateOfService}T00:00:00.000Z`);

  const claim = await prisma.arClaim.create({
    data: {
      batchId: batch.id,
      patientName: input.patientName,
      patientId: input.patientId ?? null,
      insuranceName: input.insuranceName,
      subscriberId: input.subscriberId ?? null,
      claimNumber: input.claimNumber ?? null,
      dateOfService,
      cptCode: input.cptCode ?? null,
      billedAmount: input.billedAmount ?? null,
      balance: input.balance,
      agingDays: input.agingDays ?? calculateAgingDays(dateOfService, new Date()),
      providerName: input.providerName,
      assignedToId: input.assignedToId ?? null,
      statusLabel: DEFAULT_STATUS_LABEL,
      statusCategory: DEFAULT_STATUS_CATEGORY,
    },
    include: CLAIM_INCLUDE,
  });

  // Keep the batch roll-ups in step — Postgres does the Decimal sum.
  const totals = await prisma.arClaim.aggregate({
    where: { batchId: batch.id },
    _sum: { balance: true },
    _count: true,
  });

  await prisma.arBatch.update({
    where: { id: batch.id },
    data: {
      totalClaims: totals._count,
      totalBalance: totals._sum.balance ?? 0,
    },
  });

  return NextResponse.json({ claim: toClaimDto(claim) }, { status: 201 });
}
