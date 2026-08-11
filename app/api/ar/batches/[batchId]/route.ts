import { NextResponse, type NextRequest } from "next/server";
import { apiErrorResponse, requireAuth } from "@/lib/api-helpers";
import {
  canAccessBatch,
  canManageBatches,
  practiceAssignees,
} from "@/lib/ar-access";
import { countReassignedToMe } from "@/lib/ar-reassignment";
import { batchStats, daysBetween } from "@/lib/ar-stats";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

export async function GET(
  _request: NextRequest,
  { params }: { params: { batchId: string } },
) {
  const session = await getSession();

  const denied = requireAuth(session);
  if (denied) return denied;

  if (!(await canAccessBatch(session!.user, params.batchId))) {
    return apiErrorResponse("Batch not found.", 404);
  }

  const batch = await prisma.arBatch.findUnique({
    where: { id: params.batchId },
    include: {
      practice: { select: { id: true, name: true, ehrSource: true } },
      uploadedBy: { select: { id: true, name: true } },
      closedBy: { select: { id: true, name: true } },
    },
  });

  if (!batch) {
    return apiErrorResponse("Batch not found.", 404);
  }

  // Who this batch's claims can be assigned to: the practice's own people,
  // plus Owners, who hold no membership rows but can reach everything.
  const [stats, practiceUsers, reassignedToMeCount] = await Promise.all([
    batchStats(batch.id),
    practiceAssignees(batch.practiceId),
    // What a biller has handed back and is waiting on this manager. Zero for
    // a biller, who has nobody to escalate to.
    canManageBatches(session!.user)
      ? countReassignedToMe(session!.user.id, batch.id)
      : Promise.resolve(0),
  ]);

  return NextResponse.json({
    batch: {
      id: batch.id,
      practiceId: batch.practiceId,
      practiceName: batch.practice.name,
      ehrSource: batch.ehrSource,
      reportMonth: batch.reportMonth,
      reportYear: batch.reportYear,
      status: batch.status,
      insuranceName: batch.insuranceName,
      uploadedAt: batch.uploadedAt.toISOString(),
      uploadedByName: batch.uploadedBy.name,
      uploadedById: batch.uploadedById,
      closedAt: batch.closedAt?.toISOString() ?? null,
      closedByName: batch.closedBy?.name ?? null,
      targetCompletionDate: batch.targetCompletionDate?.toISOString() ?? null,
      daysOpen: daysBetween(batch.uploadedAt, batch.closedAt ?? new Date()),
    },
    stats,
    practiceUsers,
    reassignedToMeCount,
  });
}
