import { NextResponse, type NextRequest } from "next/server";
import { BatchStatus, Role } from "@/lib/generated/prisma/enums";
import {
  apiErrorResponse,
  requireRole,
  zodErrorResponse,
} from "@/lib/api-helpers";
import { canAccessBatch } from "@/lib/ar-access";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { setTargetDateSchema } from "@/lib/validations/ar";

/** PATCH /api/ar/batches/[batchId]/target-date — set or clear the target date. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { batchId: string } },
) {
  const session = await getSession();

  const denied = requireRole(session, [Role.OWNER, Role.PROJECT_MANAGER]);
  if (denied) return denied;

  if (!(await canAccessBatch(session!.user, params.batchId))) {
    return apiErrorResponse("Batch not found.", 404);
  }

  const body = setTargetDateSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!body.success) {
    return zodErrorResponse(body.error);
  }

  const existing = await prisma.arBatch.findUnique({
    where: { id: params.batchId },
    select: { id: true, status: true },
  });

  if (!existing) {
    return apiErrorResponse("Batch not found.", 404);
  }

  if (existing.status === BatchStatus.CLOSED) {
    return apiErrorResponse(
      "This batch is closed and is read-only.",
      403,
    );
  }

  const batch = await prisma.arBatch.update({
    where: { id: params.batchId },
    data: {
      targetCompletionDate: body.data.targetCompletionDate
        ? new Date(`${body.data.targetCompletionDate}T00:00:00.000Z`)
        : null,
    },
    select: { id: true, targetCompletionDate: true },
  });

  return NextResponse.json({
    batch: {
      id: batch.id,
      targetCompletionDate: batch.targetCompletionDate?.toISOString() ?? null,
    },
  });
}
