// ADD-ONLY: this resource is append-only. Do not add PUT, PATCH or DELETE.
// ar_work_notes is the permanent audit trail (build spec §9.9, §12.2).

import { NextResponse, type NextRequest } from "next/server";
import {
  BatchStatus,
  OutcomeType,
  Role,
  StatusCategory,
} from "@/lib/generated/prisma/enums";
import { apiErrorResponse, requireAuth, zodErrorResponse } from "@/lib/api-helpers";
import { canAccessBatch } from "@/lib/ar-access";
import { resolveEscalationTarget } from "@/lib/escalation";
import { generateNote, type NoteFields } from "@/lib/ar-note-format";
import { CLAIM_INCLUDE, toClaimDto } from "@/lib/ar-serialize";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { createWorkNoteSchema } from "@/lib/validations/ar";

export async function POST(request: NextRequest) {
  const session = await getSession();

  const denied = requireAuth(session);
  if (denied) return denied;

  const body = createWorkNoteSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!body.success) {
    return zodErrorResponse(body.error);
  }

  const input = body.data;

  const claim = await prisma.arClaim.findUnique({
    where: { id: input.claimId },
    select: {
      id: true,
      batchId: true,
      claimNumber: true,
      assignedToId: true,
      batch: {
        select: { status: true, uploadedById: true, practiceId: true },
      },
    },
  });

  if (!claim || !(await canAccessBatch(session!.user, claim.batchId))) {
    return apiErrorResponse("Claim not found.", 404);
  }

  // Closed batches are read-only (spec §12.2).
  if (claim.batch.status === BatchStatus.CLOSED) {
    return apiErrorResponse(
      "This batch is closed. Notes cannot be added to a closed batch.",
      403,
    );
  }

  // Billers may only work claims assigned to them.
  const isManager =
    session!.user.role === Role.OWNER ||
    session!.user.role === Role.PROJECT_MANAGER;

  if (!isManager && claim.assignedToId !== session!.user.id) {
    return apiErrorResponse(
      "This claim is not assigned to you.",
      403,
    );
  }

  const fields = input.structuredFields as NoteFields;

  // Regenerated server-side — the client's preview text is never trusted.
  const generatedNote = generateNote(input.outcomeType, fields, {
    claimNumber: claim.claimNumber,
  });

  const followUpDate = input.followUpDateSet
    ? new Date(`${input.followUpDateSet}T00:00:00.000Z`)
    : null;

  /**
   * The claim goes to whoever owns the practice relationship — its primary PM,
   * else whoever uploaded the batch, else an owner — in two cases: a blue
   * status, which escalates automatically, and the biller ticking "reassign to
   * practice PM", which is the same handover made deliberately at any status.
   */
  const goesBlue = input.statusCategoryChangedTo === StatusCategory.BLUE;
  const handOver = goesBlue || input.reassignToPm === true;

  const escalation = handOver
    ? await resolveEscalationTarget({
        practiceId: claim.batch.practiceId,
        batchOwnerId: claim.batch.uploadedById,
      })
    : null;

  // With nobody to escalate to, the claim keeps its current assignee rather
  // than being orphaned.
  const nextAssigneeId = escalation?.userId ?? claim.assignedToId;
  const reassigned =
    handOver &&
    nextAssigneeId !== null &&
    claim.assignedToId !== nextAssigneeId;

  const [, updatedClaim] = await prisma.$transaction([
    prisma.arWorkNote.create({
      data: {
        claimId: claim.id,
        outcomeType: input.outcomeType,
        structuredFields: input.structuredFields as object,
        generatedNote,
        additionalNotes: input.additionalNotes ?? null,
        statusChangedTo: input.statusChangedTo,
        statusCategoryChangedTo: input.statusCategoryChangedTo,
        assignedToChangedId: reassigned ? nextAssigneeId : null,
        followUpDateSet: followUpDate,
        workedById: session!.user.id,
      },
    }),
    prisma.arClaim.update({
      where: { id: claim.id },
      data: {
        statusLabel: input.statusChangedTo,
        statusCategory: input.statusCategoryChangedTo,
        lastWorkedAt: new Date(),
        lastWorkedById: session!.user.id,
        ...(followUpDate ? { followUpDate } : {}),
        ...(handOver && escalation?.userId
          ? { assignedToId: escalation.userId }
          : {}),
      },
      include: CLAIM_INCLUDE,
    }),
  ]);

  // Denial reasons self-populate from real usage (spec §6.4).
  if (input.outcomeType === OutcomeType.DENIED && input.denialReason) {
    await upsertDenialReason(input.denialReason);
  }

  let reassignedToName: string | null = null;

  if (reassigned && nextAssigneeId) {
    const pm = await prisma.user.findUnique({
      where: { id: nextAssigneeId },
      select: { name: true },
    });
    reassignedToName = pm?.name ?? null;
  }

  return NextResponse.json(
    {
      claim: toClaimDto(updatedClaim),
      generatedNote,
      reassignedTo: reassignedToName,
    },
    { status: 201 },
  );
}

/**
 * Case-insensitive upsert. Postgres has no case-insensitive unique index here,
 * so the existing row is looked up with an insensitive match first; the stored
 * casing is whatever it was first entered with.
 */
async function upsertDenialReason(reason: string) {
  const trimmed = reason.trim();
  if (trimmed === "") return;

  const existing = await prisma.arDenialReason.findFirst({
    where: { reason: { equals: trimmed, mode: "insensitive" } },
    select: { id: true },
  });

  if (existing) {
    await prisma.arDenialReason.update({
      where: { id: existing.id },
      data: { usageCount: { increment: 1 }, lastUsedAt: new Date() },
    });
    return;
  }

  try {
    await prisma.arDenialReason.create({
      data: { reason: trimmed, usageCount: 1, lastUsedAt: new Date() },
    });
  } catch {
    // Lost a race against a concurrent create — increment the winner instead.
    const raced = await prisma.arDenialReason.findFirst({
      where: { reason: { equals: trimmed, mode: "insensitive" } },
      select: { id: true },
    });

    if (raced) {
      await prisma.arDenialReason.update({
        where: { id: raced.id },
        data: { usageCount: { increment: 1 }, lastUsedAt: new Date() },
      });
    }
  }
}
