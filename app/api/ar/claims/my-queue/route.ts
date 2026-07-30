import { NextResponse, type NextRequest } from "next/server";
import { BatchStatus, Role, StatusCategory } from "@/lib/generated/prisma/enums";
import {
  parsePagination,
  requireAuth,
} from "@/lib/api-helpers";
import { CLAIM_INCLUDE, toClaimDto } from "@/lib/ar-serialize";
import { startOfTodayUtc } from "@/lib/ar-stats";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

/**
 * GET /api/ar/claims/my-queue — the biller's daily work queue.
 *
 * All RED claims assigned to the caller across every practice, in open batches
 * only. Sorted oldest-and-most-overdue first (spec §7.2).
 */
export async function GET(request: NextRequest) {
  const session = await getSession();

  const denied = requireAuth(session);
  if (denied) return denied;

  const searchParams = request.nextUrl.searchParams;
  const pagination = parsePagination(searchParams);
  const today = startOfTodayUtc();

  const practiceId = searchParams.get("practiceId") ?? undefined;
  const insuranceName = searchParams.get("insuranceName") ?? undefined;
  const statusLabel = searchParams.get("statusLabel") ?? undefined;
  const followUpFrom = searchParams.get("followUpFrom") ?? undefined;
  const followUpTo = searchParams.get("followUpTo") ?? undefined;

  const followUpRange =
    followUpFrom || followUpTo
      ? {
          ...(followUpFrom
            ? { gte: new Date(`${followUpFrom}T00:00:00.000Z`) }
            : {}),
          ...(followUpTo ? { lte: new Date(`${followUpTo}T00:00:00.000Z`) } : {}),
        }
      : undefined;

  /**
   * All four queue rules are expressed in one database query — nothing is
   * filtered in JavaScript afterwards, or the pagination counts would be wrong:
   *
   *   1. assigned to the caller
   *   2. RED (biller action still pending)
   *   3. batch is OPEN
   *   4. the batch's practice is one the caller is assigned to
   *
   * Rule 4 matters even though rule 1 already narrows to this user: a biller
   * removed from a practice keeps any claims that were assigned to them, and
   * without this they would still see that practice's work.
   *
   * Owners hold implicit access to every practice and have no UserPractice
   * rows, so the join would wrongly empty their queue — they skip rule 4.
   */
  const practiceScope =
    session!.user.role === Role.OWNER
      ? {}
      : { practice: { users: { some: { userId: session!.user.id } } } };

  const where = {
    assignedToId: session!.user.id,
    statusCategory: StatusCategory.RED,
    batch: {
      status: BatchStatus.OPEN,
      ...practiceScope,
      ...(practiceId ? { practiceId } : {}),
    },
    ...(insuranceName
      ? { insuranceName: { contains: insuranceName, mode: "insensitive" as const } }
      : {}),
    ...(statusLabel ? { statusLabel } : {}),
    ...(followUpRange ? { followUpDate: followUpRange } : {}),
  };

  const [claims, total, totals, overdueCount] = await Promise.all([
    prisma.arClaim.findMany({
      where,
      orderBy: [
        { agingDays: "desc" },
        { followUpDate: { sort: "asc", nulls: "last" } },
      ],
      skip: pagination.skip,
      take: pagination.take,
      include: {
        ...CLAIM_INCLUDE,
        batch: {
          select: {
            id: true,
            reportMonth: true,
            reportYear: true,
            practice: { select: { id: true, name: true } },
          },
        },
      },
    }),
    prisma.arClaim.count({ where }),
    prisma.arClaim.aggregate({ where, _sum: { balance: true } }),
    prisma.arClaim.count({ where: { ...where, followUpDate: { lt: today } } }),
  ]);

  return NextResponse.json({
    data: claims.map((claim) => ({
      ...toClaimDto(claim),
      practiceId: claim.batch.practice.id,
      practiceName: claim.batch.practice.name,
      reportMonth: claim.batch.reportMonth,
      reportYear: claim.batch.reportYear,
    })),
    pagination: {
      page: pagination.page,
      pageSize: pagination.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pagination.pageSize)),
    },
    summary: {
      totalClaims: total,
      totalBalance: (totals._sum.balance ?? 0).toString(),
      overdueCount,
    },
  });
}
