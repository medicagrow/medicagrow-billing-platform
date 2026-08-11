import { Prisma } from "@/lib/generated/prisma/client";
import { BatchStatus, StatusCategory } from "@/lib/generated/prisma/enums";
import { prisma } from "@/lib/prisma";

/**
 * "Reassigned to me" — claims a biller handed back to their manager.
 *
 * There are two ways a claim reaches a PM's own name, and the PM needs to see
 * both in one place:
 *
 *  1. **A blue status.** `resolveEscalationTarget()` moves the claim on save;
 *     nothing records "this was a hand-over" beyond the status itself, so the
 *     status *is* the signal.
 *  2. **A manual reassignment**, from the note form's "Reassign to Practice
 *     PM" box, at any status. That writes `assignedToChangedId` on the note.
 *
 * The second cannot be read from the claim: `assignedToId` says who holds it
 * now, not how it got there, and a PM who simply assigned themselves a claim
 * has not been handed anything. So the answer comes from the note history —
 * the **most recent** note that changed the assignee. If that note points at
 * the caller, the claim was passed to them; if a later hand-over moved it on,
 * it was not.
 *
 * `DISTINCT ON` rather than a correlated subquery per claim: one round trip
 * for the whole batch, whatever its size.
 */

export interface ReassignmentContext {
  /** Who passed it over, and when — for the "↩ Reassigned by X" line. */
  reassignedByName: string;
  reassignedAt: string;
  /** The note they left with it: why it could not be finished. */
  note: string;
  /** Pre-selects the assign dropdown when the PM routes it back. */
  reassignedById: string;
}

type Scope = {
  userId: string;
  /** One batch, for the batch detail tab. */
  batchId?: string;
  /** Practices the caller may reach; null means all (Owner). */
  practiceIds?: string[] | null;
  /** My Queue looks only at live work. */
  openBatchesOnly?: boolean;
};

function scopeConditions(scope: Scope): Prisma.Sql[] {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`n."assignedToChangedId" IS NOT NULL`,
    Prisma.sql`c."assignedToId" = ${scope.userId}`,
  ];

  if (scope.batchId) {
    conditions.push(Prisma.sql`c."batchId" = ${scope.batchId}`);
  }

  if (scope.openBatchesOnly) {
    conditions.push(Prisma.sql`b.status = ${BatchStatus.OPEN}::"BatchStatus"`);
  }

  if (scope.practiceIds !== undefined && scope.practiceIds !== null) {
    // An empty list means "no practices" and must match nothing, rather than
    // collapsing into no filter at all.
    conditions.push(
      scope.practiceIds.length === 0
        ? Prisma.sql`false`
        : Prisma.sql`b."practiceId" IN (${Prisma.join(scope.practiceIds)})`,
    );
  }

  return conditions;
}

interface HandoverRow {
  claimId: string;
  assignedToChangedId: string;
  workedById: string;
  workedByName: string;
  workedAt: Date;
  generatedNote: string;
  additionalNotes: string | null;
}

/**
 * Claims whose latest assignee change handed them to `userId`, with the note
 * that came along. Blue-status claims are **not** included — the caller adds
 * those with a plain `statusCategory` filter, which the database can index.
 */
export async function manuallyReassignedTo(scope: Scope): Promise<{
  claimIds: string[];
  context: Map<string, ReassignmentContext>;
}> {
  const rows = await prisma.$queryRaw<HandoverRow[]>`
    SELECT DISTINCT ON (n."claimId")
      n."claimId"             AS "claimId",
      n."assignedToChangedId" AS "assignedToChangedId",
      n."workedById"          AS "workedById",
      u.name                  AS "workedByName",
      n."workedAt"            AS "workedAt",
      n."generatedNote"       AS "generatedNote",
      n."additionalNotes"     AS "additionalNotes"
    FROM ar_work_notes n
    JOIN ar_claims  c ON c.id = n."claimId"
    JOIN ar_batches b ON b.id = c."batchId"
    JOIN "User"     u ON u.id = n."workedById"
    WHERE ${Prisma.join(scopeConditions(scope), " AND ")}
    ORDER BY n."claimId", n."workedAt" DESC
  `;

  const claimIds: string[] = [];
  const context = new Map<string, ReassignmentContext>();

  for (const row of rows) {
    // The latest hand-over has to be the one that named the caller. An earlier
    // note pointing at them means the claim has since moved on.
    if (row.assignedToChangedId !== scope.userId) continue;

    // A PM who reassigns a claim to themselves has not been handed anything.
    if (row.workedById === scope.userId) continue;

    claimIds.push(row.claimId);
    context.set(row.claimId, {
      reassignedByName: row.workedByName,
      reassignedById: row.workedById,
      reassignedAt: row.workedAt.toISOString(),
      note: row.additionalNotes?.trim() || row.generatedNote,
    });
  }

  return { claimIds, context };
}

/**
 * How many claims are waiting on this manager — the amber count on the batch
 * summary bar and the tab badge beside it.
 *
 * Blue claims are counted by the database; the hand-overs come from the note
 * history, and the two sets overlap (a blue status also writes an assignee
 * change), so the count is one query over the union rather than a sum that
 * would double-count.
 */
export async function countReassignedToMe(
  userId: string,
  batchId: string,
): Promise<number> {
  const { claimIds } = await manuallyReassignedTo({ userId, batchId });

  return prisma.arClaim.count({
    where: {
      batchId,
      assignedToId: userId,
      OR: [
        { statusCategory: StatusCategory.BLUE },
        { id: { in: claimIds } },
      ],
    },
  });
}
