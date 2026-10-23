/**
 * Recording who moved a claim between queues.
 *
 * ADD-ONLY, like the work notes. `ArClaim.assignedToId` says who holds a claim
 * now and has never said how it got there, which is how 208 claims arrived in
 * the Owner's queue with nobody able to say who put them there — the single
 * and bulk assign routes both wrote the column and nothing else.
 *
 * Writing the row is deliberately separate from the update so the bulk path
 * can record a few thousand claims in one `createMany` rather than one insert
 * per claim.
 */

import { ArAssignmentSource } from "@/lib/generated/prisma/enums";
import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export interface AssignmentChange {
  claimId: string;
  /** Who held it before. Null when it was unassigned. */
  fromUserId: string | null;
}

/**
 * Records an assignment change for each claim.
 *
 * Rows where nothing moved are skipped: re-assigning a claim to the person
 * who already holds it is not an event, and a trail full of them is one
 * nobody reads.
 */
export async function recordAssignments(
  {
    changes,
    toUserId,
    assignedById,
    source,
  }: {
    changes: AssignmentChange[];
    toUserId: string | null;
    assignedById: string;
    source: ArAssignmentSource;
  },
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<number> {
  const moved = changes.filter((change) => change.fromUserId !== toUserId);

  if (moved.length === 0) return 0;

  const result = await client.arClaimAssignment.createMany({
    data: moved.map((change) => ({
      claimId: change.claimId,
      fromUserId: change.fromUserId,
      toUserId,
      assignedById,
      source,
    })),
  });

  return result.count;
}

export { ArAssignmentSource };
