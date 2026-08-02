import type { NextRequest } from "next/server";
import { Role, StatusCategory } from "@/lib/generated/prisma/enums";
import {
  apiErrorResponse,
  paginatedResponse,
  parsePagination,
  requireAuth,
  zodErrorResponse,
} from "@/lib/api-helpers";
import { canAccessBatch } from "@/lib/ar-access";
import { agingBucketFilter } from "@/lib/ar-aging";
import { CLAIM_INCLUDE, toClaimDto } from "@/lib/ar-serialize";
import { startOfTodayUtc } from "@/lib/ar-stats";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { listClaimsQuerySchema } from "@/lib/validations/ar";
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

  const query = listClaimsQuerySchema.safeParse({
    batchId: searchParams.get("batchId") ?? undefined,
    assignedToId: searchParams.get("assignedToId") ?? undefined,
    unassigned: searchParams.get("unassigned") ?? undefined,
    statusCategory: searchParams.get("statusCategory") ?? undefined,
    statusLabel: searchParams.get("statusLabel") ?? undefined,
    insuranceName: searchParams.get("insuranceName") ?? undefined,
    insuranceNames: searchParams.get("insuranceNames") ?? undefined,
    agingBuckets: searchParams.get("agingBuckets") ?? undefined,
    sort: searchParams.get("sort") ?? undefined,
    direction: searchParams.get("direction") ?? undefined,
    agingBucket: searchParams.get("agingBucket") ?? undefined,
    overdue: searchParams.get("overdue") ?? undefined,
  });

  if (!query.success) {
    return zodErrorResponse(query.error);
  }

  const filters = query.data;

  if (!(await canAccessBatch(session!.user, filters.batchId))) {
    return apiErrorResponse("Batch not found.", 404);
  }

  const pagination = parsePagination(searchParams);
  const agingFilter = filters.agingBucket
    ? agingBucketFilter(filters.agingBucket)
    : undefined;

  // Each selected bucket is a separate agingDays range; a claim qualifying for
  // any of them qualifies. Unrecognised keys drop out rather than matching all.
  const agingBucketRanges = (filters.agingBuckets ?? [])
    .map((key) => agingBucketFilter(key))
    .filter((range): range is NonNullable<typeof range> => range !== undefined)
    .map((range) => ({ agingDays: range }));

  /**
   * Practice access is already checked above via canAccessBatch. Billers are
   * additionally narrowed to their own claims: they may only work what is
   * assigned to them, so there is no reason to hand them the rest of the
   * batch's patient data. PMs and Owners still see the whole batch.
   *
   * Applied last in the object below so a client-supplied assignedToId cannot
   * widen it.
   */
  const billerScope =
    session!.user.role === Role.BILLER
      ? { assignedToId: session!.user.id }
      : {};

  const where = {
    batchId: filters.batchId,
    ...(filters.unassigned === "true" ? { assignedToId: null } : {}),
    ...(filters.assignedToId ? { assignedToId: filters.assignedToId } : {}),
    ...(filters.statusCategory
      ? { statusCategory: filters.statusCategory }
      : {}),
    ...(filters.statusLabel ? { statusLabel: filters.statusLabel } : {}),
    ...(filters.insuranceNames
      ? { insuranceName: { in: filters.insuranceNames } }
      : {}),
    // Each bucket is its own agingDays range, so several are an OR.
    ...(agingBucketRanges.length > 0 ? { OR: agingBucketRanges } : {}),
    ...(filters.insuranceName
      ? { insuranceName: { contains: filters.insuranceName, mode: "insensitive" as const } }
      : {}),
    ...(agingFilter ? { agingDays: agingFilter } : {}),
    ...(filters.overdue === "true"
      ? {
          statusCategory: StatusCategory.RED,
          followUpDate: { lt: startOfTodayUtc() },
        }
      : {}),
    ...billerScope,
  };

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

  return paginatedResponse(claims.map(toClaimDto), total, pagination);
}
