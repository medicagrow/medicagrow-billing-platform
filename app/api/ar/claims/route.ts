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
      orderBy: [{ agingDays: "desc" }, { patientName: "asc" }],
      skip: pagination.skip,
      take: pagination.take,
      include: CLAIM_INCLUDE,
    }),
    prisma.arClaim.count({ where }),
  ]);

  return paginatedResponse(claims.map(toClaimDto), total, pagination);
}
