import { NextResponse, type NextRequest } from "next/server";
import {
  ArStatusRequestItemStatus,
  Role,
} from "@/lib/generated/prisma/enums";
import {
  apiErrorResponse,
  requireAuth,
  requireRole,
  zodErrorResponse,
} from "@/lib/api-helpers";
import { canAccessBatch } from "@/lib/ar-access";
import { arErrorResponse } from "@/lib/ar/route-errors";
import { createStatusRequest } from "@/lib/ar/status-requests";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { quickUpdateSchema } from "@/lib/validations/ar";

/**
 * A guard, not a page: a batch's open requests are a review queue a manager
 * works through, so the list is bounded rather than paginated.
 */
const MAX_OPEN_REQUESTS = 200;

/**
 * POST /api/ar/status-requests — a biller asks for a status change on one or
 * more of their claims. Nothing changes until a manager approves it.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();

  const denied = requireAuth(session);
  if (denied) return denied;

  const body = quickUpdateSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!body.success) return zodErrorResponse(body.error);

  try {
    return NextResponse.json(
      await createStatusRequest(session!.user, body.data),
      { status: 201 },
    );
  } catch (error) {
    return arErrorResponse(error);
  }
}

/**
 * GET /api/ar/status-requests?batchId= — the requests still waiting on a
 * decision for one batch. A partially approved request is still listed: it has
 * claims nobody has decided yet, and hiding it would strand them.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();

  const denied = requireRole(session, [Role.OWNER, Role.PROJECT_MANAGER]);
  if (denied) return denied;

  const batchId = request.nextUrl.searchParams.get("batchId");

  if (!batchId) return apiErrorResponse("batchId is required.", 400);

  if (!(await canAccessBatch(session!.user, batchId))) {
    return apiErrorResponse("Batch not found.", 404);
  }

  const requests = await prisma.arStatusRequest.findMany({
    /**
     * Open means "has an item nobody has decided", not a request status: one
     * approved and one rejected item is PARTIALLY_APPROVED with nothing left
     * to review, and must drop out of the queue.
     */
    where: {
      batchId,
      items: { some: { itemStatus: ArStatusRequestItemStatus.PENDING } },
    },
    orderBy: { createdAt: "asc" },
    take: MAX_OPEN_REQUESTS,
    select: {
      id: true,
      requestedStatus: true,
      requestedCategory: true,
      note: true,
      status: true,
      createdAt: true,
      requestedBy: { select: { id: true, name: true } },
      items: {
        orderBy: { claim: { patientName: "asc" } },
        select: {
          claimId: true,
          itemStatus: true,
          rejectionNote: true,
          claim: {
            select: {
              patientName: true,
              insuranceName: true,
              statusLabel: true,
              statusCategory: true,
              balance: true,
              agingDays: true,
            },
          },
        },
      },
    },
  });

  return NextResponse.json({
    data: requests.map((entry) => ({
      id: entry.id,
      requestedStatus: entry.requestedStatus,
      requestedCategory: entry.requestedCategory,
      note: entry.note,
      status: entry.status,
      createdAt: entry.createdAt.toISOString(),
      requestedById: entry.requestedBy.id,
      requestedByName: entry.requestedBy.name,
      pendingCount: entry.items.filter(
        (item) => item.itemStatus === ArStatusRequestItemStatus.PENDING,
      ).length,
      items: entry.items.map((item) => ({
        claimId: item.claimId,
        itemStatus: item.itemStatus,
        rejectionNote: item.rejectionNote,
        patientName: item.claim.patientName,
        insuranceName: item.claim.insuranceName,
        currentStatus: item.claim.statusLabel,
        currentCategory: item.claim.statusCategory,
        balance: item.claim.balance.toString(),
        agingDays: item.claim.agingDays,
      })),
    })),
  });
}
