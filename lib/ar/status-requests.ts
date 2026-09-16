import type { Prisma } from "@/lib/generated/prisma/client";
import {
  ArStatusRequestItemStatus,
  ArStatusRequestStatus,
  BatchStatus,
  OutcomeType,
  Role,
  StatusCategory,
} from "@/lib/generated/prisma/enums";
import { canAccessBatch } from "@/lib/ar-access";
import { statusLabelToCategory } from "@/lib/ar-status";
import { resolveEscalationTarget } from "@/lib/escalation";
import { formatDate } from "@/lib/format";
import { prisma } from "@/lib/prisma";

/**
 * Quick status updates, the requests billers file for them, and the review
 * that decides those requests one claim at a time.
 *
 * Three routes write claim statuses through here — a manager's direct quick
 * update, an approved request, and the bulk follow-up date — and a fourth
 * (the full note form) predates it. Keeping the first three on one function
 * means a status set by approval cannot behave differently from the same
 * status set directly: same note shape, same blue-status escalation, same
 * `lastWorkedAt` stamp.
 */

export class StatusRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

type Tx = Prisma.TransactionClient;

interface ActingUser {
  id: string;
  role: Role;
}

const isManager = (user: ActingUser) =>
  user.role === Role.OWNER || user.role === Role.PROJECT_MANAGER;

/**
 * Loads claims for a write and checks everything a write needs: they exist,
 * they sit in **one** batch, the caller may reach it, and it is still open.
 *
 * One batch because every caller works from one batch page, and because a
 * blue status escalates to that batch's owner — a mixed set would need a
 * different destination per claim.
 */
async function loadClaimsForWrite(user: ActingUser, claimIds: string[]) {
  const unique = Array.from(new Set(claimIds));

  const claims = await prisma.arClaim.findMany({
    where: { id: { in: unique } },
    select: {
      id: true,
      batchId: true,
      assignedToId: true,
      statusLabel: true,
      pendingStatusRequestId: true,
      batch: {
        select: { status: true, practiceId: true, uploadedById: true },
      },
    },
  });

  if (claims.length !== unique.length) {
    throw new StatusRequestError("One or more claims were not found.", 404);
  }

  const batchIds = new Set(claims.map((claim) => claim.batchId));

  if (batchIds.size !== 1) {
    throw new StatusRequestError(
      "All selected claims must belong to the same batch.",
      400,
    );
  }

  const batchId = claims[0]!.batchId;

  if (!(await canAccessBatch(user, batchId))) {
    throw new StatusRequestError("Batch not found.", 404);
  }

  if (claims[0]!.batch.status === BatchStatus.CLOSED) {
    throw new StatusRequestError(
      "This batch is closed and read-only.",
      403,
    );
  }

  return { claims, batchId, batch: claims[0]!.batch };
}

/**
 * Writes a status change onto a set of claims — one work note each and the
 * claim fields — inside the caller's transaction.
 *
 * `workedById` is **whoever did the work**, which for an approved request is
 * the biller who asked, not the manager who approved: productivity reads work
 * notes, and the call was the biller's. The approval is recorded in the note
 * text instead.
 */
async function writeStatusChange(
  tx: Tx,
  input: {
    claims: { id: string; assignedToId: string | null }[];
    batch: { practiceId: string; uploadedById: string };
    statusLabel: string;
    note: string;
    workedById: string;
    approvedByName?: string;
  },
) {
  if (input.claims.length === 0) return 0;

  const category = statusLabelToCategory(input.statusLabel);

  /**
   * A blue status hands the claim to whoever owns the practice relationship,
   * exactly as it does from the full note form. Resolved once — every claim
   * here shares one batch, so every claim shares one destination.
   */
  const escalation =
    category === StatusCategory.BLUE
      ? await resolveEscalationTarget({
          practiceId: input.batch.practiceId,
          batchOwnerId: input.batch.uploadedById,
        })
      : null;

  const now = new Date();

  const generatedNote =
    `Quick update: status changed to "${input.statusLabel}".` +
    (input.approvedByName ? ` Approved by ${input.approvedByName}.` : "");

  await tx.arWorkNote.createMany({
    data: input.claims.map((claim) => ({
      claimId: claim.id,
      outcomeType: OutcomeType.OTHER,
      structuredFields: { source: "quick-update" },
      generatedNote,
      additionalNotes: input.note,
      statusChangedTo: input.statusLabel,
      statusCategoryChangedTo: category,
      assignedToChangedId:
        escalation?.userId && claim.assignedToId !== escalation.userId
          ? escalation.userId
          : null,
      workedById: input.workedById,
      workedAt: now,
    })),
  });

  await tx.arClaim.updateMany({
    where: { id: { in: input.claims.map((claim) => claim.id) } },
    data: {
      statusLabel: input.statusLabel,
      statusCategory: category,
      lastWorkedAt: now,
      lastWorkedById: input.workedById,
      ...(escalation?.userId ? { assignedToId: escalation.userId } : {}),
    },
  });

  return input.claims.length;
}

/**
 * Re-derives a request's overall status from its items.
 *
 * - anything still pending and nothing approved → PENDING
 * - anything approved while something else is pending or rejected →
 *   PARTIALLY_APPROVED
 * - everything approved → APPROVED; everything rejected → REJECTED
 */
export function requestStatusFor(
  items: { itemStatus: ArStatusRequestItemStatus }[],
): ArStatusRequestStatus {
  const approved = items.filter(
    (item) => item.itemStatus === ArStatusRequestItemStatus.APPROVED,
  ).length;
  const rejected = items.filter(
    (item) => item.itemStatus === ArStatusRequestItemStatus.REJECTED,
  ).length;
  const pending = items.length - approved - rejected;

  if (pending === items.length) return ArStatusRequestStatus.PENDING;
  if (approved === items.length) return ArStatusRequestStatus.APPROVED;
  if (rejected === items.length) return ArStatusRequestStatus.REJECTED;
  if (approved === 0) return ArStatusRequestStatus.PENDING;

  return ArStatusRequestStatus.PARTIALLY_APPROVED;
}

async function recomputeRequests(tx: Tx, requestIds: string[]) {
  if (requestIds.length === 0) return;

  const requests = await tx.arStatusRequest.findMany({
    where: { id: { in: requestIds } },
    select: { id: true, items: { select: { itemStatus: true } } },
  });

  for (const request of requests) {
    await tx.arStatusRequest.update({
      where: { id: request.id },
      data: { status: requestStatusFor(request.items) },
    });
  }
}

/* -------------------------------------------------------------------------- */

/**
 * A manager's quick update: applied at once, no request.
 *
 * Any claim with a biller's request still pending has that item rejected as
 * superseded — otherwise approving it later would quietly overwrite the
 * manager's own, newer decision.
 */
export async function applyQuickUpdate(
  user: ActingUser,
  input: { claimIds: string[]; statusLabel: string; note: string },
) {
  if (!isManager(user)) {
    throw new StatusRequestError(
      "Only a project manager or owner can update status directly.",
      403,
    );
  }

  const { claims, batch } = await loadClaimsForWrite(user, input.claimIds);

  const superseded = claims
    .filter((claim) => claim.pendingStatusRequestId !== null)
    .map((claim) => claim.id);

  const affectedRequests = Array.from(
    new Set(
      claims
        .map((claim) => claim.pendingStatusRequestId)
        .filter((id): id is string => id !== null),
    ),
  );

  return prisma.$transaction(async (tx) => {
    if (superseded.length > 0) {
      await tx.arStatusRequestItem.updateMany({
        where: {
          claimId: { in: superseded },
          itemStatus: ArStatusRequestItemStatus.PENDING,
        },
        data: {
          itemStatus: ArStatusRequestItemStatus.REJECTED,
          reviewedAt: new Date(),
          rejectionNote: "Superseded by a direct status update.",
        },
      });

      await tx.arClaim.updateMany({
        where: { id: { in: superseded } },
        data: { pendingStatusRequestId: null },
      });

      await recomputeRequests(tx, affectedRequests);
    }

    const updated = await writeStatusChange(tx, {
      claims,
      batch,
      statusLabel: input.statusLabel,
      note: input.note,
      workedById: user.id,
    });

    return { updated, superseded: superseded.length };
  });
}

/**
 * A biller's request, one item per claim.
 *
 * Claims already covered by a pending request are **skipped and reported**,
 * not refused wholesale — selecting twenty claims and losing the request
 * because one of them was already waiting would be the wrong trade.
 */
export async function createStatusRequest(
  user: ActingUser,
  input: { claimIds: string[]; statusLabel: string; note: string },
) {
  const { claims, batchId } = await loadClaimsForWrite(user, input.claimIds);

  // A biller asks only about their own work; a manager may file one too.
  if (!isManager(user) && claims.some((claim) => claim.assignedToId !== user.id)) {
    throw new StatusRequestError(
      "You can only request changes to claims assigned to you.",
      403,
    );
  }

  const available = claims.filter(
    (claim) => claim.pendingStatusRequestId === null,
  );

  if (available.length === 0) {
    throw new StatusRequestError(
      "Every selected claim already has a status change awaiting approval.",
      409,
    );
  }

  const request = await prisma.$transaction(async (tx) => {
    const created = await tx.arStatusRequest.create({
      data: {
        batchId,
        requestedById: user.id,
        requestedStatus: input.statusLabel,
        requestedCategory: statusLabelToCategory(input.statusLabel),
        note: input.note,
        items: {
          create: available.map((claim) => ({ claimId: claim.id })),
        },
      },
      select: { id: true },
    });

    /**
     * Claimed with a guard on the pointer being empty, so two requests racing
     * for the same claim cannot both take it. Anything lost to the race is
     * dropped from this request rather than left double-booked.
     */
    const claimed = await tx.arClaim.updateMany({
      where: {
        id: { in: available.map((claim) => claim.id) },
        pendingStatusRequestId: null,
      },
      data: { pendingStatusRequestId: created.id },
    });

    if (claimed.count !== available.length) {
      const held = await tx.arClaim.findMany({
        where: {
          id: { in: available.map((claim) => claim.id) },
          pendingStatusRequestId: created.id,
        },
        select: { id: true },
      });

      await tx.arStatusRequestItem.deleteMany({
        where: {
          requestId: created.id,
          claimId: { notIn: held.map((claim) => claim.id) },
        },
      });

      if (held.length === 0) {
        throw new StatusRequestError(
          "Those claims were claimed by another request a moment ago.",
          409,
        );
      }
    }

    return created;
  });

  return {
    requestId: request.id,
    requested: available.length,
    skipped: claims.length - available.length,
  };
}

export interface ReviewDecision {
  claimId: string;
  decision: "APPROVED" | "REJECTED";
  rejectionNote?: string;
}

/**
 * Decides some or all of a request's claims.
 *
 * **Per item.** Only the claims marked APPROVED change status; rejected ones,
 * and any left undecided, are untouched. A decision on an item that has
 * already been decided is ignored rather than re-applied, so a double-click or
 * a stale review screen cannot write a status twice.
 */
export async function reviewStatusRequest(
  reviewer: ActingUser & { name: string },
  requestId: string,
  decisions: ReviewDecision[],
) {
  if (!isManager(reviewer)) {
    throw new StatusRequestError(
      "Only a project manager or owner can review requests.",
      403,
    );
  }

  const request = await prisma.arStatusRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      batchId: true,
      requestedById: true,
      requestedStatus: true,
      note: true,
      batch: {
        select: { status: true, practiceId: true, uploadedById: true },
      },
      items: {
        select: {
          claimId: true,
          itemStatus: true,
          claim: { select: { id: true, assignedToId: true } },
        },
      },
    },
  });

  if (!request || !(await canAccessBatch(reviewer, request.batchId))) {
    throw new StatusRequestError("Request not found.", 404);
  }

  if (request.batch.status === BatchStatus.CLOSED) {
    throw new StatusRequestError(
      "This batch is closed. Its requests can no longer be approved.",
      403,
    );
  }

  const pendingItems = new Map(
    request.items
      .filter((item) => item.itemStatus === ArStatusRequestItemStatus.PENDING)
      .map((item) => [item.claimId, item]),
  );

  const approve = decisions.filter(
    (decision) =>
      decision.decision === "APPROVED" && pendingItems.has(decision.claimId),
  );
  const reject = decisions.filter(
    (decision) =>
      decision.decision === "REJECTED" && pendingItems.has(decision.claimId),
  );

  const decidedIds = [...approve, ...reject].map((decision) => decision.claimId);

  return prisma.$transaction(async (tx) => {
    const now = new Date();

    const applied = await writeStatusChange(tx, {
      claims: approve.map((decision) => pendingItems.get(decision.claimId)!.claim),
      batch: request.batch,
      statusLabel: request.requestedStatus,
      note: request.note,
      workedById: request.requestedById,
      approvedByName: reviewer.name,
    });

    if (approve.length > 0) {
      await tx.arStatusRequestItem.updateMany({
        where: {
          requestId: request.id,
          claimId: { in: approve.map((decision) => decision.claimId) },
        },
        data: {
          itemStatus: ArStatusRequestItemStatus.APPROVED,
          reviewedAt: now,
        },
      });
    }

    // Rejections carry their own notes, so they are written one by one.
    for (const decision of reject) {
      await tx.arStatusRequestItem.update({
        where: {
          requestId_claimId: {
            requestId: request.id,
            claimId: decision.claimId,
          },
        },
        data: {
          itemStatus: ArStatusRequestItemStatus.REJECTED,
          reviewedAt: now,
          rejectionNote: decision.rejectionNote?.trim() || null,
        },
      });
    }

    // Decided claims are free for a new request; undecided ones stay held.
    if (decidedIds.length > 0) {
      await tx.arClaim.updateMany({
        where: { id: { in: decidedIds }, pendingStatusRequestId: request.id },
        data: { pendingStatusRequestId: null },
      });
    }

    const items = await tx.arStatusRequestItem.findMany({
      where: { requestId: request.id },
      select: { itemStatus: true },
    });

    const status = requestStatusFor(items);

    await tx.arStatusRequest.update({
      where: { id: request.id },
      data: {
        status,
        ...(decidedIds.length > 0
          ? { reviewedById: reviewer.id, reviewedAt: now }
          : {}),
      },
    });

    return {
      approved: applied,
      rejected: reject.length,
      ignored: decisions.length - decidedIds.length,
      remaining: items.filter(
        (item) => item.itemStatus === ArStatusRequestItemStatus.PENDING,
      ).length,
      status,
    };
  });
}

/* -------------------------------------------------------------------------- */

/**
 * Sets one follow-up date on many claims.
 *
 * No approval: a follow-up date is scheduling, not a verdict on the claim.
 * A biller may only set it on their own claims. Each claim gets a minimal note
 * so the change is visible in its history — the note keeps the claim's
 * current status, since nothing about the status changed.
 */
export async function bulkSetFollowUp(
  user: ActingUser,
  input: { claimIds: string[]; followUpDate: string; note?: string },
) {
  const { claims } = await loadClaimsForWrite(user, input.claimIds);

  if (!isManager(user) && claims.some((claim) => claim.assignedToId !== user.id)) {
    throw new StatusRequestError(
      "You can only set follow-up dates on claims assigned to you.",
      403,
    );
  }

  const followUpDate = new Date(`${input.followUpDate}T00:00:00.000Z`);
  const generatedNote = `Follow-up date set to ${formatDate(followUpDate)} via bulk update.`;
  const now = new Date();

  await prisma.$transaction([
    prisma.arWorkNote.createMany({
      data: claims.map((claim) => ({
        claimId: claim.id,
        outcomeType: OutcomeType.OTHER,
        structuredFields: { source: "bulk-follow-up" },
        generatedNote,
        additionalNotes: input.note?.trim() || null,
        statusChangedTo: claim.statusLabel,
        statusCategoryChangedTo: statusLabelToCategory(claim.statusLabel),
        followUpDateSet: followUpDate,
        workedById: user.id,
        workedAt: now,
      })),
    }),
    prisma.arClaim.updateMany({
      where: { id: { in: claims.map((claim) => claim.id) } },
      data: {
        followUpDate,
        lastWorkedAt: now,
        lastWorkedById: user.id,
      },
    }),
  ]);

  return { updated: claims.length };
}
