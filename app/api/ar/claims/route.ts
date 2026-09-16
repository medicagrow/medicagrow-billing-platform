import { NextResponse, type NextRequest } from "next/server";
import { StatusCategory } from "@/lib/generated/prisma/enums";
import {
  apiErrorResponse,
  parsePagination,
  requireAuth,
  zodErrorResponse,
} from "@/lib/api-helpers";
import { canAccessBatch } from "@/lib/ar-access";
import { ACTIONABLE_WHERE } from "@/lib/ar-actionable";
import { centsToDecimalString, toCents } from "@/lib/money";
import { claimListWhere, parseClaimFilters } from "@/lib/ar-claim-filters";
import { manuallyReassignedTo } from "@/lib/ar-reassignment";
import { CLAIM_INCLUDE, toClaimDto } from "@/lib/ar-serialize";
import { startOfTodayUtc } from "@/lib/ar-stats";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import type { Prisma } from "@/lib/generated/prisma/client";

/** Aging descending is the working order; the rest are opt-in. */
function claimOrderBy(
  sort: string | undefined,
  direction: "asc" | "desc" = "asc",
): Prisma.ArClaimOrderByWithRelationInput[] {
  switch (sort) {
    case "patientName":
      return [{ patientName: direction }];
    case "provider":
      // renderingProvider is the specific name; providerName is the fallback
      // the column displays, so both order together.
      return [
        { renderingProvider: { sort: direction, nulls: "last" } },
        { providerName: { sort: direction, nulls: "last" } },
      ];
    case "balance":
      return [{ balance: direction }];
    case "status":
      return [{ statusCategory: direction }, { statusLabel: direction }];
    case "aging":
      return [{ agingDays: direction }, { patientName: "asc" }];
    default:
      return [{ agingDays: "desc" }, { patientName: "asc" }];
  }
}

/** GET /api/ar/claims — paginated claim list for one batch. */
export async function GET(request: NextRequest) {
  const session = await getSession();

  const denied = requireAuth(session);
  if (denied) return denied;

  const searchParams = request.nextUrl.searchParams;

  const query = parseClaimFilters(searchParams);

  if (!query.success) {
    return zodErrorResponse(query.error);
  }

  const filters = query.data;

  if (!(await canAccessBatch(session!.user, filters.batchId))) {
    return apiErrorResponse("Batch not found.", 404);
  }

  const pagination = parsePagination(searchParams);

  // Shared with the export, so the file and the table cannot disagree about
  // what the filters mean.
  const where = await claimListWhere(
    filters,
    session!.user,
    startOfTodayUtc(),
  );

  /**
   * The summary bar's figures, over the same filters — but **always** over
   * actionable claims, even when the checkbox or a 0–30 bucket has put fresh
   * claims on screen. A total, a balance and an average in this module
   * describe workable claims; the rows can show more.
   */
  const statsWhere = { AND: [where, ACTIONABLE_WHERE] };

  const [claims, total, byCategory, unassignedCount] = await Promise.all([
    prisma.arClaim.findMany({
      where,
      orderBy: claimOrderBy(filters.sort, filters.direction),
      skip: pagination.skip,
      take: pagination.take,
      include: CLAIM_INCLUDE,
    }),
    prisma.arClaim.count({ where }),
    prisma.arClaim.groupBy({
      by: ["statusCategory"],
      where: statsWhere,
      _count: { _all: true },
      _sum: { balance: true, agingDays: true },
    }),
    prisma.arClaim.count({
      where: { AND: [statsWhere, { assignedToId: null }] },
    }),
  ]);

  /**
   * The hand-over context rides along on the rows that have one, so the
   * "Reassigned to Me" tab can say who passed the claim over and why without
   * a second request per row. Only resolved when that tab asked for it.
   */
  const reassignment =
    filters.reassignedToMe === "true"
      ? await manuallyReassignedTo({
          userId: session!.user.id,
          batchId: filters.batchId,
        })
      : null;

  /**
   * What each row's pending request is asking for, for the ⏳ marker. One
   * lookup for the page rather than a join on every claim query.
   */
  const pendingIds = Array.from(
    new Set(
      claims
        .map((claim) => claim.pendingStatusRequestId)
        .filter((id): id is string => id !== null),
    ),
  );

  const pendingRequests = new Map(
    (pendingIds.length > 0
      ? await prisma.arStatusRequest.findMany({
          where: { id: { in: pendingIds } },
          select: { id: true, requestedStatus: true },
        })
      : []
    ).map((entry) => [entry.id, entry.requestedStatus]),
  );

  const countIn = (category: StatusCategory) =>
    byCategory.find((row) => row.statusCategory === category)?._count._all ?? 0;

  const statsCount = byCategory.reduce((sum, row) => sum + row._count._all, 0);
  const agingSum = byCategory.reduce(
    (sum, row) => sum + (row._sum.agingDays ?? 0),
    0,
  );
  const balanceCents = byCategory.reduce(
    (sum, row) => sum + toCents(row._sum.balance?.toString()),
    0n,
  );

  const totalPages = Math.max(1, Math.ceil(total / pagination.pageSize));

  return NextResponse.json({
    data: claims.map((claim) => ({
      ...toClaimDto(claim),
      reassignment: reassignment?.context.get(claim.id) ?? null,
      pendingStatus: claim.pendingStatusRequestId
        ? (pendingRequests.get(claim.pendingStatusRequestId) ?? null)
        : null,
    })),
    pagination: {
      page: pagination.page,
      pageSize: pagination.pageSize,
      total,
      totalPages,
    },
    meta: {
      totalCount: statsCount,
      totalBalance: centsToDecimalString(balanceCents),
      redCount: countIn(StatusCategory.RED),
      blueCount: countIn(StatusCategory.BLUE),
      greenCount: countIn(StatusCategory.GREEN),
      unassignedCount,
      avgAgingDays: statsCount === 0 ? 0 : Math.round(agingSum / statsCount),
      page: pagination.page,
      totalPages,
      limit: pagination.pageSize,
    },
  });
}
