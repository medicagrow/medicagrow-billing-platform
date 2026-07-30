import { NextResponse, type NextRequest } from "next/server";
import { BatchStatus, Role } from "@/lib/generated/prisma/enums";
import { apiErrorResponse, requireRole } from "@/lib/api-helpers";
import { canAccessBatch } from "@/lib/ar-access";
import { batchStats } from "@/lib/ar-stats";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

/** PATCH /api/ar/batches/[batchId]/close — close a batch; it becomes read-only. */
export async function PATCH(
  _request: NextRequest,
  { params }: { params: { batchId: string } },
) {
  const session = await getSession();

  const denied = requireRole(session, [Role.OWNER, Role.PROJECT_MANAGER]);
  if (denied) return denied;

  if (!(await canAccessBatch(session!.user, params.batchId))) {
    return apiErrorResponse("Batch not found.", 404);
  }

  const existing = await prisma.arBatch.findUnique({
    where: { id: params.batchId },
    select: { id: true, status: true },
  });

  if (!existing) {
    return apiErrorResponse("Batch not found.", 404);
  }

  if (existing.status === BatchStatus.CLOSED) {
    return apiErrorResponse("This batch is already closed.", 409);
  }

  const batch = await prisma.arBatch.update({
    where: { id: params.batchId },
    data: {
      status: BatchStatus.CLOSED,
      closedById: session!.user.id,
      closedAt: new Date(),
    },
    include: {
      practice: { select: { name: true } },
      closedBy: { select: { name: true } },
    },
  });

  const stats = await batchStats(batch.id);

  return NextResponse.json({
    batch: {
      id: batch.id,
      practiceName: batch.practice.name,
      status: batch.status,
      closedAt: batch.closedAt?.toISOString() ?? null,
      closedByName: batch.closedBy?.name ?? null,
    },
    stats,
  });
}
