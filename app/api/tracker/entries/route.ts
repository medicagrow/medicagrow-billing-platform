import { NextResponse, type NextRequest } from "next/server";
import { LockStatus, Role } from "@/lib/generated/prisma/enums";
import {
  apiErrorResponse,
  requireAuth,
  requireRole,
  zodErrorResponse,
} from "@/lib/api-helpers";
import { accessiblePracticeIds, canAccessPractice } from "@/lib/ar-access";
import { getTrackerConfig } from "@/lib/tracker/config";
import { calculateScores } from "@/lib/tracker/scoring";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import {
  dateToMonthYear,
  listTrackerQuerySchema,
  monthYearToDate,
  upsertTrackerEntrySchema,
} from "@/lib/validations/tracker";

const decimal = (value: unknown) =>
  value === null || value === undefined ? null : Number(value);

/** GET /api/tracker/entries — entries with their scores. */
export async function GET(request: NextRequest) {
  const session = await getSession();

  const denied = requireAuth(session);
  if (denied) return denied;

  const searchParams = request.nextUrl.searchParams;

  const query = listTrackerQuerySchema.safeParse({
    practiceId: searchParams.get("practiceId") ?? undefined,
    monthYear: searchParams.get("monthYear") ?? undefined,
    from: searchParams.get("from") ?? undefined,
    to: searchParams.get("to") ?? undefined,
  });

  if (!query.success) {
    return zodErrorResponse(query.error);
  }

  const practiceIds = await accessiblePracticeIds(session!.user);

  const monthFilter = query.data.monthYear
    ? { equals: monthYearToDate(query.data.monthYear) }
    : query.data.from || query.data.to
      ? {
          ...(query.data.from
            ? { gte: monthYearToDate(query.data.from) }
            : {}),
          ...(query.data.to ? { lte: monthYearToDate(query.data.to) } : {}),
        }
      : undefined;

  const entries = await prisma.trackerEntry.findMany({
    where: {
      ...(practiceIds === null ? {} : { practiceId: { in: practiceIds } }),
      ...(query.data.practiceId ? { practiceId: query.data.practiceId } : {}),
      ...(monthFilter ? { monthYear: monthFilter } : {}),
    },
    orderBy: [{ monthYear: "desc" }, { practice: { name: "asc" } }],
    include: {
      practice: { select: { id: true, name: true } },
      lockedBy: { select: { name: true } },
    },
  });

  return NextResponse.json({
    data: entries.map((entry) => ({
      id: entry.id,
      practiceId: entry.practiceId,
      practiceName: entry.practice.name,
      monthYear: dateToMonthYear(entry.monthYear),
      scoreA: entry.scoreA,
      scoreB: entry.scoreB,
      scoreC: entry.scoreC,
      scoreD: entry.scoreD,
      scoreE: entry.scoreE,
      scoreF: entry.scoreF,
      scoreG: entry.scoreG,
      scoreH: entry.scoreH,
      finalScore: decimal(entry.finalScore),
      lockStatus: entry.lockStatus,
      lockedAt: entry.lockedAt?.toISOString() ?? null,
      lockedByName: entry.lockedBy?.name ?? null,
      updatedAt: entry.updatedAt.toISOString(),
    })),
  });
}

/** POST /api/tracker/entries — create or update one practice-month. */
export async function POST(request: NextRequest) {
  const session = await getSession();

  const denied = requireRole(session, [Role.OWNER, Role.PROJECT_MANAGER]);
  if (denied) return denied;

  const body = upsertTrackerEntrySchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!body.success) {
    return zodErrorResponse(body.error);
  }

  const input = body.data;

  if (!(await canAccessPractice(session!.user, input.practiceId))) {
    return apiErrorResponse("You do not have access to this practice.", 403);
  }

  const monthYear = monthYearToDate(input.monthYear);

  const existing = await prisma.trackerEntry.findUnique({
    where: {
      practiceId_monthYear: { practiceId: input.practiceId, monthYear },
    },
    select: { id: true, lockStatus: true },
  });

  if (existing?.lockStatus === LockStatus.LOCKED) {
    return apiErrorResponse(
      "This entry is locked and can no longer be edited.",
      403,
    );
  }

  // Scores are always recomputed here — never accepted from the client, and
  // always against the owner-configured weights and bands.
  const config = await getTrackerConfig();

  const scores = calculateScores({
    totalPayments: input.totalPayments,
    totalAdjustments: input.totalAdjustments,
    totalCharges: input.totalCharges,
    pendingClaimsToBill: input.pendingClaimsToBill,
    pendingEraToPost: input.pendingEraToPost,
    pendingPatientPaymentsToPost: input.pendingPatientPaymentsToPost,
    rejectionsReceived: input.rejectionsReceived,
    outstandingRejections: input.outstandingRejections,
    eobDenialsReceived: input.eobDenialsReceived,
    outstandingEobDenials: input.outstandingEobDenials,
    totalClaims: input.totalClaims,
    arAmount0to30: input.arAmount0to30,
    arAmount31to60: input.arAmount31to60,
    arAmount61to90: input.arAmount61to90,
    arAmount90plus: input.arAmount90plus,
    followUpCompliance: input.followUpCompliance,
    totalAppointmentsForElig: input.totalAppointmentsForElig,
    eligibilityCompleted: input.eligibilityCompleted,
    eftEnrollment: input.eftEnrollment,
    eraEnrollment: input.eraEnrollment,
    portalAccess: input.portalAccess,
    feeSchedule: input.feeSchedule,
    sopCompliance: input.sopCompliance,
    resourcesAssigned: input.resourcesAssigned,
    monthlyReviewMeeting: input.monthlyReviewMeeting,
    directClientCommunication: input.directClientCommunication,
    netCollectionRateManual: input.netCollectionRateManual,
    paymentEfficiencyManual: input.paymentEfficiencyManual,
  }, config);

  const data = {
    totalAppointments: input.totalAppointments ?? null,
    totalVisits: input.totalVisits ?? null,
    totalClaims: input.totalClaims ?? null,
    totalCharges: input.totalCharges ?? null,
    totalPayments: input.totalPayments ?? null,
    totalAdjustments: input.totalAdjustments ?? null,
    netCollectionRate: scores.netCollectionRate,
    paymentEfficiency: scores.paymentEfficiency,
    netCollectionRateManual: input.netCollectionRateManual ?? null,
    paymentEfficiencyManual: input.paymentEfficiencyManual ?? null,
    pendingClaimsToBill: input.pendingClaimsToBill ?? null,
    pendingEraToPost: input.pendingEraToPost ?? null,
    pendingPatientPaymentsToPost: input.pendingPatientPaymentsToPost ?? null,
    rejectionsReceived: input.rejectionsReceived ?? null,
    outstandingRejections: input.outstandingRejections ?? null,
    eobDenialsReceived: input.eobDenialsReceived ?? null,
    outstandingEobDenials: input.outstandingEobDenials ?? null,
    denialRate: scores.denialRate,
    arCount0to30: input.arCount0to30 ?? null,
    arAmount0to30: input.arAmount0to30 ?? null,
    arCount31to60: input.arCount31to60 ?? null,
    arAmount31to60: input.arAmount31to60 ?? null,
    arCount61to90: input.arCount61to90 ?? null,
    arAmount61to90: input.arAmount61to90 ?? null,
    arCount90plus: input.arCount90plus ?? null,
    arAmount90plus: input.arAmount90plus ?? null,
    totalAr: scores.totalAr,
    arPercentOver90: scores.arPercentOver90,
    followUpCompliance: input.followUpCompliance ?? null,
    totalAppointmentsForElig: input.totalAppointmentsForElig ?? null,
    eligibilityCompleted: input.eligibilityCompleted ?? null,
    eligibilityCompliance: scores.eligibilityCompliance,
    eftEnrollment: input.eftEnrollment ?? null,
    eraEnrollment: input.eraEnrollment ?? null,
    portalAccess: input.portalAccess ?? null,
    feeSchedule: input.feeSchedule ?? null,
    sopCompliance: input.sopCompliance ?? null,
    resourcesAssigned: input.resourcesAssigned ?? null,
    monthlyReviewMeeting: input.monthlyReviewMeeting,
    directClientCommunication: input.directClientCommunication,
    scoreA: scores.scoreA,
    scoreB: scores.scoreB,
    scoreC: scores.scoreC,
    scoreD: scores.scoreD,
    scoreE: scores.scoreE,
    scoreF: scores.scoreF,
    scoreG: scores.scoreG,
    scoreH: scores.scoreH,
    finalScore: scores.finalScore,
  };

  const entry = await prisma.trackerEntry.upsert({
    where: {
      practiceId_monthYear: { practiceId: input.practiceId, monthYear },
    },
    create: {
      practiceId: input.practiceId,
      monthYear,
      enteredById: session!.user.id,
      ...data,
    },
    update: { lastUpdatedById: session!.user.id, ...data },
    include: { practice: { select: { name: true } } },
  });

  return NextResponse.json(
    {
      entry: {
        id: entry.id,
        practiceId: entry.practiceId,
        practiceName: entry.practice.name,
        monthYear: dateToMonthYear(entry.monthYear),
        finalScore: decimal(entry.finalScore),
        lockStatus: entry.lockStatus,
      },
      scores,
    },
    { status: existing ? 200 : 201 },
  );
}
