import { NextResponse, type NextRequest } from "next/server";
import { StatusCategory } from "@/lib/generated/prisma/enums";
import { apiErrorResponse, requireAuth } from "@/lib/api-helpers";
import { canAccessPractice } from "@/lib/ar-access";
import { EOB_ENTRY_INCLUDE, toEobEntryDto } from "@/lib/eob-serialize";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

/** GET /api/eob/batches/[batchId] — batch detail with every entry. */
export async function GET(
  _request: NextRequest,
  { params }: { params: { batchId: string } },
) {
  const session = await getSession();

  const denied = requireAuth(session);
  if (denied) return denied;

  const batch = await prisma.eobBatch.findUnique({
    where: { id: params.batchId },
    include: {
      practice: { select: { id: true, name: true } },
      postedBy: { select: { id: true, name: true } },
      entries: {
        orderBy: [{ dateOfService: "asc" }, { patientName: "asc" }],
        include: EOB_ENTRY_INCLUDE,
      },
    },
  });

  if (
    !batch ||
    !(await canAccessPractice(session!.user, batch.practiceId))
  ) {
    return apiErrorResponse("Batch not found.", 404);
  }

  const entries = batch.entries.map(toEobEntryDto);

  return NextResponse.json({
    batch: {
      id: batch.id,
      practiceId: batch.practiceId,
      practiceName: batch.practice.name,
      payerName: batch.payerName,
      batchDate: batch.batchDate.toISOString(),
      batchReference: batch.batchReference,
      totalAmount: batch.totalAmount.toString(),
      notes: batch.notes,
      postedById: batch.postedById,
      postedByName: batch.postedBy.name,
      postedAt: batch.postedAt.toISOString(),
    },
    entries,
    stats: {
      total: entries.length,
      unresolved: entries.filter(
        (entry) => entry.statusCategory !== StatusCategory.GREEN,
      ).length,
      denials: entries.filter((entry) => entry.entryType === "DENIAL").length,
      rejections: entries.filter((entry) => entry.entryType === "REJECTION")
        .length,
      blue: entries.filter(
        (entry) => entry.statusCategory === StatusCategory.BLUE,
      ).length,
    },
  });
}
