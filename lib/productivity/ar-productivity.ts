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
  forOneUser,
  type ActivityDetailPage,
  type ActivitySummary,
  practiceFilterFor,
  type ProductivityByUser,
  type ProductivityQuery,
  type TeamProductivityQuery,
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

/** Shared note filter: these users, this window, and whichever practices apply. */
function noteWhere(query: TeamProductivityQuery) {
  const practices = practiceFilterFor(query);

  return {
    workedById: { in: query.userIds },
    workedAt: { gte: query.from, lte: query.to },
    ...(Object.keys(practices).length > 0
      ? { claim: { batch: practices } }
      : {}),
  };
}

/** Running totals for one person, filled in as their notes are read. */
interface ArTally {
  /** Claim id → its balance in cents. A claim worked twice counts once. */
  claimsWorked: Map<string, bigint>;
  movedToGreen: Map<string, bigint>;
  denialsWorked: number;
  resubmitted: number;
  appealsSubmitted: number;
  escalated: number;
}

const emptyTally = (): ArTally => ({
  claimsWorked: new Map(),
  movedToGreen: new Map(),
  denialsWorked: 0,
  resubmitted: 0,
  appealsSubmitted: 0,
  escalated: 0,
});

function sumCents(balances: Map<string, bigint>): string {
  let cents = 0n;
  for (const value of balances.values()) cents += value;
  return centsToDecimalString(cents);
}

/**
 * Every AR figure for a whole team, in **one query**.
 *
 * This used to be six queries per person: two `findMany`s that fetched notes
 * and deduplicated claims in JS, plus four `count`s. The four counts are
 * derivable from the same rows the first two already fetched, so reading the
 * window once and tallying it is strictly less work than it was — and it is
 * one round trip instead of six per head.
 *
 * The counts cannot be pushed into SQL as a `groupBy` without giving up the
 * distinct-claim ones: "claims worked" is distinct claims, and their value is
 * the sum over *distinct* claims, which needs the rows.
 */
export async function getArProductivity(
  query: TeamProductivityQuery,
): Promise<ProductivityByUser> {
  const notes =
    query.userIds.length === 0
      ? []
      : await prisma.arWorkNote.findMany({
          where: noteWhere(query),
          select: {
            workedById: true,
            claimId: true,
            outcomeType: true,
            statusChangedTo: true,
            statusCategoryChangedTo: true,
            claim: { select: { balance: true } },
          },
        });

  const tallies = new Map<string, ArTally>();

  for (const note of notes) {
    let tally = tallies.get(note.workedById);

    if (!tally) {
      tally = emptyTally();
      tallies.set(note.workedById, tally);
    }

    const cents = toCents(note.claim.balance.toString());

    if (!tally.claimsWorked.has(note.claimId)) {
      tally.claimsWorked.set(note.claimId, cents);
    }

    if (note.statusCategoryChangedTo === StatusCategory.GREEN) {
      if (!tally.movedToGreen.has(note.claimId)) {
        tally.movedToGreen.set(note.claimId, cents);
      }
    }

    if (note.outcomeType === OutcomeType.DENIED) tally.denialsWorked += 1;
    if (RESUBMITTED_STATUSES.includes(note.statusChangedTo)) {
      tally.resubmitted += 1;
    }
    if (APPEAL_STATUSES.includes(note.statusChangedTo)) {
      tally.appealsSubmitted += 1;
    }
    if (note.statusCategoryChangedTo === StatusCategory.BLUE) {
      tally.escalated += 1;
    }
  }

  const byUser: ProductivityByUser = new Map();

  // Everyone asked for gets a row, so a quiet week reads as zeroes rather
  // than as a missing person.
  for (const userId of query.userIds) {
    const tally = tallies.get(userId) ?? emptyTally();

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
        userId,
        key,
        query.from,
        query.to,
        query.practiceId,
      ),
    });

    byUser.set(userId, [
      summary(
        AR_ACTIVITIES.CLAIMS_WORKED,
        tally.claimsWorked.size,
        sumCents(tally.claimsWorked),
      ),
      summary(
        AR_ACTIVITIES.MOVED_TO_GREEN,
        tally.movedToGreen.size,
        sumCents(tally.movedToGreen),
      ),
      summary(AR_ACTIVITIES.DENIALS_WORKED, tally.denialsWorked),
      summary(AR_ACTIVITIES.RESUBMITTED, tally.resubmitted),
      summary(AR_ACTIVITIES.APPEALS_SUBMITTED, tally.appealsSubmitted),
      summary(AR_ACTIVITIES.ESCALATED_TO_OFFICE, tally.escalated),
    ]);
  }

  return byUser;
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

  const where = { ...noteWhere(forOneUser(query)), ...filter };

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
    where: noteWhere(forOneUser(query)),
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
