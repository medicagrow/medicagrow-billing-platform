import type { NextRequest } from "next/server";
import {
  apiErrorResponse,
  paginatedResponse,
  parsePagination,
  requireAuth,
  zodErrorResponse,
} from "@/lib/api-helpers";
import { canAccessBatch } from "@/lib/ar-access";
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

  const [claims, total] = await Promise.all([
    prisma.arClaim.findMany({
      where,
      orderBy: claimOrderBy(filters.sort, filters.direction),
      skip: pagination.skip,
      take: pagination.take,
      include: CLAIM_INCLUDE,
    }),
    prisma.arClaim.count({ where }),
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

  return paginatedResponse(
    claims.map((claim) => ({
      ...toClaimDto(claim),
      reassignment: reassignment?.context.get(claim.id) ?? null,
    })),
    total,
    pagination,
  );
}
