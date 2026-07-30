import { NextResponse, type NextRequest } from "next/server";
import { BatchStatus } from "@/lib/generated/prisma/enums";
import { apiErrorResponse, requireAuth } from "@/lib/api-helpers";
import { canAccessBatch } from "@/lib/ar-access";
import { CLAIM_INCLUDE, toClaimDto } from "@/lib/ar-serialize";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

const PRIOR_HISTORY_LIMIT = 5;
const PRIOR_HISTORY_DAY_WINDOW = 7;

/**
 * Loosest useful token from a patient name for the ILIKE match — the longest
 * word, which is nearly always the surname regardless of "Last, First" or
 * "First Last" ordering across EHRs.
 */
function fuzzyToken(patientName: string): string {
  const tokens = patientName
    .split(/[\s,]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);

  return tokens.sort((a, b) => b.length - a.length)[0] ?? patientName;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { claimId: string } },
) {
  const session = await getSession();

  const denied = requireAuth(session);
  if (denied) return denied;

  const claim = await prisma.arClaim.findUnique({
    where: { id: params.claimId },
    include: {
      ...CLAIM_INCLUDE,
      batch: {
        select: {
          id: true,
          status: true,
          reportMonth: true,
          reportYear: true,
          ehrSource: true,
          uploadedById: true,
          uploadedBy: { select: { id: true, name: true } },
          practice: { select: { id: true, name: true } },
        },
      },
      workNotes: {
        orderBy: { workedAt: "desc" },
        include: { workedBy: { select: { id: true, name: true } } },
      },
    },
  });

  if (!claim || !(await canAccessBatch(session!.user, claim.batchId))) {
    return apiErrorResponse("Claim not found.", 404);
  }

  // Prior history (spec §7.4): same practice, closed batches, same insurance,
  // DOS within +/-7 days, fuzzy patient-name match. Reference only.
  const windowStart = new Date(claim.dateOfService);
  windowStart.setUTCDate(windowStart.getUTCDate() - PRIOR_HISTORY_DAY_WINDOW);
  const windowEnd = new Date(claim.dateOfService);
  windowEnd.setUTCDate(windowEnd.getUTCDate() + PRIOR_HISTORY_DAY_WINDOW);

  const priorClaims = await prisma.arClaim.findMany({
    where: {
      id: { not: claim.id },
      insuranceName: { equals: claim.insuranceName, mode: "insensitive" },
      dateOfService: { gte: windowStart, lte: windowEnd },
      patientName: { contains: fuzzyToken(claim.patientName), mode: "insensitive" },
      batch: {
        practiceId: claim.batch.practice.id,
        status: BatchStatus.CLOSED,
      },
    },
    take: PRIOR_HISTORY_LIMIT,
    orderBy: { dateOfService: "desc" },
    include: {
      batch: { select: { reportMonth: true, reportYear: true } },
      workNotes: {
        orderBy: { workedAt: "desc" },
        include: { workedBy: { select: { name: true } } },
      },
    },
  });

  return NextResponse.json({
    claim: {
      ...toClaimDto(claim),
      batch: {
        id: claim.batch.id,
        status: claim.batch.status,
        reportMonth: claim.batch.reportMonth,
        reportYear: claim.batch.reportYear,
        ehrSource: claim.batch.ehrSource,
        practiceId: claim.batch.practice.id,
        practiceName: claim.batch.practice.name,
        projectManagerId: claim.batch.uploadedById,
        projectManagerName: claim.batch.uploadedBy.name,
      },
    },
    workNotes: claim.workNotes.map((note) => ({
      id: note.id,
      outcomeType: note.outcomeType,
      generatedNote: note.generatedNote,
      additionalNotes: note.additionalNotes,
      statusChangedTo: note.statusChangedTo,
      statusCategoryChangedTo: note.statusCategoryChangedTo,
      followUpDateSet: note.followUpDateSet?.toISOString() ?? null,
      workedByName: note.workedBy.name,
      workedAt: note.workedAt.toISOString(),
      structuredFields: note.structuredFields,
    })),
    priorHistory: priorClaims.map((prior) => ({
      id: prior.id,
      reportMonth: prior.batch.reportMonth,
      reportYear: prior.batch.reportYear,
      dateOfService: prior.dateOfService.toISOString(),
      patientName: prior.patientName,
      insuranceName: prior.insuranceName,
      balance: String(prior.balance),
      statusLabel: prior.statusLabel,
      statusCategory: prior.statusCategory,
      notes: prior.workNotes.map((note) => ({
        id: note.id,
        generatedNote: note.generatedNote,
        additionalNotes: note.additionalNotes,
        outcomeType: note.outcomeType,
        workedByName: note.workedBy.name,
        workedAt: note.workedAt.toISOString(),
      })),
    })),
  });
}
