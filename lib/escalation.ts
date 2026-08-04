import { Role } from "@/lib/generated/prisma/enums";
import { prisma } from "@/lib/prisma";

/**
 * Who an escalation goes to.
 *
 * BLUE means "this needs the practice side to answer something", so it leaves
 * the biller's queue and lands with whoever owns the relationship. The chain
 * is the same for AR and EOB, which is why it lives here rather than being
 * written twice and drifting.
 *
 *   1. the practice's primary PM, if one is set
 *   2. whoever owns the batch — uploaded it for AR, posted it for EOB
 *   3. an owner, as a last resort
 *
 * Falling all the way through returns null, and the caller leaves the
 * assignment alone rather than orphaning the record.
 */

export type EscalationReason =
  | "practice_primary_pm"
  | "batch_owner"
  | "platform_owner"
  | "unresolved";

export interface EscalationTarget {
  userId: string | null;
  reason: EscalationReason;
}

export async function resolveEscalationTarget({
  practiceId,
  batchOwnerId,
}: {
  practiceId: string | null | undefined;
  /** ArBatch.uploadedById, or EobBatch.postedById. */
  batchOwnerId: string | null | undefined;
}): Promise<EscalationTarget> {
  if (practiceId) {
    const practice = await prisma.practice.findUnique({
      where: { id: practiceId },
      select: { primaryPm: { select: { id: true, isActive: true } } },
    });

    // A deactivated PM is not a destination: their queue is not being read.
    if (practice?.primaryPm?.isActive) {
      return { userId: practice.primaryPm.id, reason: "practice_primary_pm" };
    }
  }

  if (batchOwnerId) {
    return { userId: batchOwnerId, reason: "batch_owner" };
  }

  const owner = await prisma.user.findFirst({
    where: { role: Role.OWNER, isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  return owner
    ? { userId: owner.id, reason: "platform_owner" }
    : { userId: null, reason: "unresolved" };
}

export interface EscalationPreview {
  /** Who the record would go to right now, by name. */
  name: string | null;
  reason: EscalationReason;
  /** Whether the practice has a live primary PM to route to. */
  hasPrimaryPm: boolean;
}

/**
 * The same chain, resolved to a name so a form can say where the record is
 * about to go before it goes there.
 *
 * Resolving it here rather than showing the batch uploader keeps the promise
 * on screen and the routing on save from disagreeing.
 */
export async function describeEscalationTarget(input: {
  practiceId: string | null | undefined;
  batchOwnerId: string | null | undefined;
}): Promise<EscalationPreview> {
  const target = await resolveEscalationTarget(input);

  if (!target.userId) {
    return { name: null, reason: target.reason, hasPrimaryPm: false };
  }

  const user = await prisma.user.findUnique({
    where: { id: target.userId },
    select: { name: true },
  });

  return {
    name: user?.name ?? null,
    reason: target.reason,
    hasPrimaryPm: target.reason === "practice_primary_pm",
  };
}
