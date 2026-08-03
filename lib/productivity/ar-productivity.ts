import { OutcomeType, StatusCategory } from "@/lib/generated/prisma/enums";
import { centsToDecimalString, toCents } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import {
  AR_ACTIVITIES,
  AR_ACTIVITY_LABELS,
  APPEAL_STATUSES,
  RESUBMITTED_STATUSES,
  type ArActivityKey,
} from "@/lib/productivity/ar-activities";
import {
  buildDrillDownUrl,
  type ActivityDetailPage,
  type ActivitySummary,
  practiceFilterFor,
  type ProductivityQuery,
} from "@/lib/productivity/types";

/**
 * AR module productivity, derived entirely from the ar_work_notes audit trail.
 *
 * Every figure counts work *logged in the window*, not the claim's current
 * state, so a report for last month does not change as claims move on.
 */

export {
  AR_ACTIVITIES,
  AR_ACTIVITY_LABELS,
  type ArActivityKey,
} from "@/lib/productivity/ar-activities";

/** Shared note filter: this user, this window, and whichever practices apply. */
function noteWhere(query: ProductivityQuery) {
  const practices = practiceFilterFor(query);

  return {
    workedById: query.userId,
    workedAt: { gte: query.from, lte: query.to },
    ...(Object.keys(practices).length > 0
      ? { claim: { batch: practices } }
      : {}),
  };
}

/** Distinct claims touched, plus the balance they represent. */
async function distinctClaims(
  query: ProductivityQuery,
  extra: Record<string, unknown> = {},
): Promise<{ count: number; totalValue: string }> {
  const notes = await prisma.arWorkNote.findMany({
    where: { ...noteWhere(query), ...extra },
    select: { claimId: true, claim: { select: { balance: true } } },
  });

  const seen = new Map<string, bigint>();

  for (const note of notes) {
    if (!seen.has(note.claimId)) {
      seen.set(note.claimId, toCents(note.claim.balance.toString()));
    }
  }

  let cents = 0n;
  for (const value of seen.values()) cents += value;

  return { count: seen.size, totalValue: centsToDecimalString(cents) };
}

export async function getArProductivity(
  query: ProductivityQuery,
): Promise<ActivitySummary[]> {
  const where = noteWhere(query);

  const [
    claimsWorked,
    movedToGreen,
    denialsWorked,
    resubmitted,
    appealsSubmitted,
    escalated,
  ] = await Promise.all([
    distinctClaims(query),
    distinctClaims(query, { statusCategoryChangedTo: StatusCategory.GREEN }),
    prisma.arWorkNote.count({
      where: { ...where, outcomeType: OutcomeType.DENIED },
    }),
    prisma.arWorkNote.count({
      where: { ...where, statusChangedTo: { in: RESUBMITTED_STATUSES } },
    }),
    prisma.arWorkNote.count({
      where: { ...where, statusChangedTo: { in: APPEAL_STATUSES } },
    }),
    prisma.arWorkNote.count({
      where: { ...where, statusCategoryChangedTo: StatusCategory.BLUE },
    }),
  ]);

  const summary = (
    key: ArActivityKey,
    count: number,
    totalValue?: string,
  ): ActivitySummary => ({
    module: "AR",
    key,
    label: AR_ACTIVITY_LABELS[key],
    count,
    totalValue,
    drillDownUrl: buildDrillDownUrl(
      query.userId,
      key,
      query.from,
      query.to,
      query.practiceId,
    ),
  });

  return [
    summary(
      AR_ACTIVITIES.CLAIMS_WORKED,
      claimsWorked.count,
      claimsWorked.totalValue,
    ),
    summary(
      AR_ACTIVITIES.MOVED_TO_GREEN,
      movedToGreen.count,
      movedToGreen.totalValue,
    ),
    summary(AR_ACTIVITIES.DENIALS_WORKED, denialsWorked),
    summary(AR_ACTIVITIES.RESUBMITTED, resubmitted),
    summary(AR_ACTIVITIES.APPEALS_SUBMITTED, appealsSubmitted),
    summary(AR_ACTIVITIES.ESCALATED_TO_OFFICE, escalated),
  ];
}

/* -------------------------------------------------------------------------- */

export interface ArActivityRow {
  claimId: string;
  patientName: string;
  insuranceName: string;
  dateOfService: string;
  practiceName: string;
  reportMonth: number;
  reportYear: number;
  statusLabel: string;
  statusCategory: StatusCategory;
  balance: string;
  noteDate: string;
  outcomeType: OutcomeType;
  statusChangedTo: string;
  denialReason: string | null;
  actionTaken: string | null;
  generatedNote: string;
}

/** Note-level filter for each activity's drill-down. */
function detailFilter(activityKey: string): Record<string, unknown> | null {
  switch (activityKey) {
    case AR_ACTIVITIES.CLAIMS_WORKED:
      return {};
    case AR_ACTIVITIES.MOVED_TO_GREEN:
      return { statusCategoryChangedTo: StatusCategory.GREEN };
    case AR_ACTIVITIES.DENIALS_WORKED:
      return { outcomeType: OutcomeType.DENIED };
    case AR_ACTIVITIES.RESUBMITTED:
      return { statusChangedTo: { in: RESUBMITTED_STATUSES } };
    case AR_ACTIVITIES.APPEALS_SUBMITTED:
      return { statusChangedTo: { in: APPEAL_STATUSES } };
    case AR_ACTIVITIES.ESCALATED_TO_OFFICE:
      return { statusCategoryChangedTo: StatusCategory.BLUE };
    default:
      return null;
  }
}

export async function getArActivityDetail(
  query: ProductivityQuery & {
    activityKey: string;
    skip: number;
    take: number;
  },
): Promise<ActivityDetailPage<ArActivityRow> | null> {
  const filter = detailFilter(query.activityKey);
  if (filter === null) return null;

  const where = { ...noteWhere(query), ...filter };

  const [notes, total] = await Promise.all([
    prisma.arWorkNote.findMany({
      where,
      orderBy: { workedAt: "desc" },
      skip: query.skip,
      take: query.take,
      select: {
        workedAt: true,
        outcomeType: true,
        statusChangedTo: true,
        generatedNote: true,
        structuredFields: true,
        claim: {
          select: {
            id: true,
            patientName: true,
            insuranceName: true,
            dateOfService: true,
            statusLabel: true,
            statusCategory: true,
            balance: true,
            batch: {
              select: {
                reportMonth: true,
                reportYear: true,
                practice: { select: { name: true } },
              },
            },
          },
        },
      },
    }),
    prisma.arWorkNote.count({ where }),
  ]);

  const rows: ArActivityRow[] = notes.map((note) => {
    const fields = (note.structuredFields ?? {}) as Record<string, unknown>;

    return {
      claimId: note.claim.id,
      patientName: note.claim.patientName,
      insuranceName: note.claim.insuranceName,
      dateOfService: note.claim.dateOfService.toISOString(),
      practiceName: note.claim.batch.practice.name,
      reportMonth: note.claim.batch.reportMonth,
      reportYear: note.claim.batch.reportYear,
      statusLabel: note.claim.statusLabel,
      statusCategory: note.claim.statusCategory,
      balance: note.claim.balance.toString(),
      noteDate: note.workedAt.toISOString(),
      outcomeType: note.outcomeType,
      statusChangedTo: note.statusChangedTo,
      denialReason:
        typeof fields.denialReason === "string" ? fields.denialReason : null,
      actionTaken:
        typeof fields.actionTaken === "string" ? fields.actionTaken : null,
      generatedNote: note.generatedNote,
    };
  });

  return {
    activityKey: query.activityKey,
    label:
      AR_ACTIVITY_LABELS[query.activityKey as ArActivityKey] ?? "AR Activity",
    module: "AR",
    rows,
    total,
    page: Math.floor(query.skip / Math.max(1, query.take)) + 1,
    pageSize: query.take,
    totalPages: Math.max(1, Math.ceil(total / Math.max(1, query.take))),
  };
}

/** Most recent notes by this user, for the activity timeline. */
export async function getArRecentActivity(
  query: ProductivityQuery,
  limit = 20,
) {
  const notes = await prisma.arWorkNote.findMany({
    where: noteWhere(query),
    orderBy: { workedAt: "desc" },
    take: limit,
    select: {
      id: true,
      workedAt: true,
      outcomeType: true,
      statusChangedTo: true,
      statusCategoryChangedTo: true,
      claim: {
        select: {
          id: true,
          patientName: true,
          batch: { select: { practice: { select: { name: true } } } },
        },
      },
    },
  });

  return notes.map((note) => ({
    id: note.id,
    module: "AR" as const,
    workedAt: note.workedAt.toISOString(),
    recordId: note.claim.id,
    recordLabel: note.claim.patientName,
    recordUrl: `/ar/claims/${note.claim.id}`,
    practiceName: note.claim.batch.practice.name,
    outcomeType: note.outcomeType,
    statusChangedTo: note.statusChangedTo,
    statusCategoryChangedTo: note.statusCategoryChangedTo,
  }));
}
