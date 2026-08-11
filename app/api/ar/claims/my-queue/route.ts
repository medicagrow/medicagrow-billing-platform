import { NextResponse, type NextRequest } from "next/server";
import { BatchStatus, Role, StatusCategory } from "@/lib/generated/prisma/enums";
import { parsePagination, requireAuth } from "@/lib/api-helpers";
import { accessiblePracticeIds } from "@/lib/ar-access";
import { ACTIONABLE_WHERE } from "@/lib/ar-actionable";
import { manuallyReassignedTo } from "@/lib/ar-reassignment";
import { CLAIM_INCLUDE, toClaimDto } from "@/lib/ar-serialize";
import { startOfTodayUtc } from "@/lib/ar-stats";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import type { Prisma } from "@/lib/generated/prisma/client";

/**
 * GET /api/ar/claims/my-queue — the biller's daily work queue.
 *
 * Three views over one set of scoping rules, chosen by `view`:
 *
 *   active     (default) RED claims still to be worked
 *   completed  GREEN claims this person finished — their own record of work
 *   reassigned claims handed to them, for a PM who also works claims
 *
 * The scope is identical in all three, which is the point: one place decides
 * who may see what, so adding a view cannot quietly widen it. The tab counts
 * come back on every response and honour the same filters, so switching tabs
 * lands on exactly what the badge promised.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();

  const denied = requireAuth(session);
  if (denied) return denied;

  const user = session!.user;
  const searchParams = request.nextUrl.searchParams;
  const pagination = parsePagination(searchParams);
  const today = startOfTodayUtc();

  const view = searchParams.get("view") ?? "active";

  const practiceId = searchParams.get("practiceId") ?? undefined;
  const insuranceName = searchParams.get("insuranceName") ?? undefined;
  const statusLabel = searchParams.get("statusLabel") ?? undefined;
  const followUpFrom = searchParams.get("followUpFrom") ?? undefined;
  const followUpTo = searchParams.get("followUpTo") ?? undefined;
  const visitStatus = searchParams.get("visitStatus") ?? undefined;
  const search = searchParams.get("search")?.trim() || undefined;

  const insuranceNames = (searchParams.get("insuranceNames") ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "");

  /**
   * 0–30 day claims are out of the queue by default: insurance has not had
   * time to process them, so working one is a wasted call. The toggle exists
   * because a biller with a clear queue may reasonably want to look ahead.
   */
  const includeNotActionable =
    searchParams.get("includeNotActionable") === "true";

  /**
   * The queue rules are expressed in the database query — nothing is filtered
   * in JavaScript afterwards, or the pagination counts would drift from the
   * rows:
   *
   *   1. assigned to the caller
   *   2. the status the view asks for
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
    user.role === Role.OWNER
      ? {}
      : { practice: { users: { some: { userId: user.id } } } };

  /**
   * Which claims were *handed* to this person, as opposed to simply being
   * theirs. Resolved before the main query because both the rows and their
   * count depend on it, and both must agree.
   */
  const reassigned = await manuallyReassignedTo({
    userId: user.id,
    practiceIds: await accessiblePracticeIds(user),
    openBatchesOnly: true,
  });

  /** A hand-over is either a blue status or a note that named this person. */
  const reassignedScope: Prisma.ArClaimWhereInput = {
    OR: [
      { statusCategory: StatusCategory.BLUE },
      { id: { in: reassigned.claimIds } },
    ],
  };

  /**
   * Everything the three views share. Held apart from the status and the date
   * range so the tab counts can be taken over the same filters without
   * inheriting the current view's idea of what a date means.
   */
  const sharedWhere: Prisma.ArClaimWhereInput = {
    assignedToId: user.id,
    batch: {
      status: BatchStatus.OPEN,
      ...practiceScope,
      ...(practiceId ? { practiceId } : {}),
    },
    ...(includeNotActionable ? {} : ACTIONABLE_WHERE),
    ...(search
      ? {
          AND: [
            {
              OR: [
                { patientName: { contains: search, mode: "insensitive" } },
                { cptCode: { contains: search, mode: "insensitive" } },
                { visitId: { contains: search, mode: "insensitive" } },
              ],
            },
          ],
        }
      : {}),
    ...(insuranceNames.length > 0
      ? { insuranceName: { in: insuranceNames } }
      : insuranceName
        ? {
            insuranceName: {
              contains: insuranceName,
              mode: "insensitive" as const,
            },
          }
        : {}),
    ...(statusLabel ? { statusLabel } : {}),
    ...(visitStatus ? { visitStatus } : {}),
  };

  /**
   * The date range means different things per view, because the question does:
   * an active claim is filtered on when it is next due, a completed one on
   * when it was finished.
   */
  const dateWhere: Prisma.ArClaimWhereInput =
    !followUpFrom && !followUpTo
      ? {}
      : view === "completed"
        ? {
            lastWorkedAt: {
              ...(followUpFrom
                ? { gte: new Date(`${followUpFrom}T00:00:00.000Z`) }
                : {}),
              ...(followUpTo
                ? { lte: new Date(`${followUpTo}T23:59:59.999Z`) }
                : {}),
            },
          }
        : {
            followUpDate: {
              ...(followUpFrom
                ? { gte: new Date(`${followUpFrom}T00:00:00.000Z`) }
                : {}),
              ...(followUpTo
                ? { lte: new Date(`${followUpTo}T00:00:00.000Z`) }
                : {}),
            },
          };

  const viewScope: Prisma.ArClaimWhereInput =
    view === "completed"
      ? { statusCategory: StatusCategory.GREEN }
      : view === "reassigned"
        ? reassignedScope
        : { statusCategory: StatusCategory.RED };

  const where: Prisma.ArClaimWhereInput = {
    ...sharedWhere,
    ...viewScope,
    ...dateWhere,
  };

  const startOfMonth = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1),
  );

  const [
    claims,
    total,
    totals,
    overdueCount,
    completedThisMonth,
    activeCount,
    completedCount,
    reassignedCount,
  ] = await Promise.all([
    prisma.arClaim.findMany({
      where,
      orderBy:
        view === "completed"
          ? // Most recently finished first — the tab reads as a log.
            [{ lastWorkedAt: { sort: "desc", nulls: "last" } }]
          : [
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
    // Overdue is only a question about work still to do.
    view === "active"
      ? prisma.arClaim.count({ where: { ...where, followUpDate: { lt: today } } })
      : Promise.resolve(0),
    prisma.arClaim.count({
      where: {
        assignedToId: user.id,
        statusCategory: StatusCategory.GREEN,
        lastWorkedAt: { gte: startOfMonth },
        batch: { status: BatchStatus.OPEN, ...practiceScope },
      },
    }),
    prisma.arClaim.count({
      where: { ...sharedWhere, statusCategory: StatusCategory.RED },
    }),
    prisma.arClaim.count({
      where: { ...sharedWhere, statusCategory: StatusCategory.GREEN },
    }),
    prisma.arClaim.count({ where: { ...sharedWhere, ...reassignedScope } }),
  ]);

  return NextResponse.json({
    data: claims.map((claim) => ({
      ...toClaimDto(claim),
      practiceId: claim.batch.practice.id,
      practiceName: claim.batch.practice.name,
      reportMonth: claim.batch.reportMonth,
      reportYear: claim.batch.reportYear,
      reassignment: reassigned.context.get(claim.id) ?? null,
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
      completedThisMonth,
    },
    counts: {
      active: activeCount,
      completed: completedCount,
      reassigned: reassignedCount,
    },
  });
}
