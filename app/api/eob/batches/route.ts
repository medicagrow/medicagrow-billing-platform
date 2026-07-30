import { NextResponse, type NextRequest } from "next/server";
import { Role, StatusCategory } from "@/lib/generated/prisma/enums";
import {
  apiErrorResponse,
  paginatedResponse,
  parsePagination,
  requireAuth,
  requireRole,
  zodErrorResponse,
} from "@/lib/api-helpers";
import { canAccessPractice, practiceScopeFilter } from "@/lib/ar-access";
import {
  DEFAULT_EOB_STATUS_CATEGORY,
  DEFAULT_EOB_STATUS_LABEL,
} from "@/lib/eob-status";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import {
  createEobBatchSchema,
  listEobBatchesQuerySchema,
} from "@/lib/validations/eob";

/** POST /api/eob/batches — log an ERA/EOB with its denials and rejections. */
export async function POST(request: NextRequest) {
  const session = await getSession();

  const denied = requireRole(session, [
    Role.OWNER,
    Role.PROJECT_MANAGER,
    Role.BILLER,
  ]);
  if (denied) return denied;

  const body = createEobBatchSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!body.success) {
    return zodErrorResponse(body.error);
  }

  const input = body.data;

  if (!(await canAccessPractice(session!.user, input.practiceId))) {
    return apiErrorResponse("You do not have access to this practice.", 403);
  }

  const batch = await prisma.eobBatch.create({
    data: {
      practiceId: input.practiceId,
      batchDate: new Date(`${input.batchDate}T00:00:00.000Z`),
      batchReference: input.batchReference ?? null,
      payerName: input.payerName,
      totalAmount: input.totalAmount,
      postedById: session!.user.id,
      notes: input.notes ?? null,
      entries: {
        create: input.entries.map((entry) => ({
          entryType: entry.entryType,
          patientName: entry.patientName,
          claimNumber: entry.claimNumber ?? null,
          dateOfService: new Date(`${entry.dateOfService}T00:00:00.000Z`),
          cptCode: entry.cptCode ?? null,
          billedAmount: entry.billedAmount ?? null,
          deniedAmount: entry.deniedAmount ?? null,
          denialCode: entry.denialCode ?? null,
          denialReason: entry.denialReason,
          rejectionReason: entry.rejectionReason ?? null,
          actionRequired: entry.actionRequired ?? null,
          arClaimId: entry.arClaimId ?? null,
          // Everything starts unreviewed.
          statusLabel: DEFAULT_EOB_STATUS_LABEL,
          statusCategory: DEFAULT_EOB_STATUS_CATEGORY,
        })),
      },
    },
    include: {
      practice: { select: { name: true } },
      _count: { select: { entries: true } },
    },
  });

  return NextResponse.json(
    {
      batch: {
        id: batch.id,
        practiceId: batch.practiceId,
        practiceName: batch.practice.name,
        payerName: batch.payerName,
        batchDate: batch.batchDate.toISOString(),
        totalAmount: batch.totalAmount.toString(),
        entryCount: batch._count.entries,
      },
      entryCount: batch._count.entries,
    },
    { status: 201 },
  );
}

/** GET /api/eob/batches — scoped, paginated batch list. */
export async function GET(request: NextRequest) {
  const session = await getSession();

  const denied = requireAuth(session);
  if (denied) return denied;

  const searchParams = request.nextUrl.searchParams;

  const query = listEobBatchesQuerySchema.safeParse({
    practiceId: searchParams.get("practiceId") ?? undefined,
    payerName: searchParams.get("payerName") ?? undefined,
    from: searchParams.get("from") ?? undefined,
    to: searchParams.get("to") ?? undefined,
  });

  if (!query.success) {
    return zodErrorResponse(query.error);
  }

  const pagination = parsePagination(searchParams);
  const scope = await practiceScopeFilter(session!.user);

  const dateRange =
    query.data.from || query.data.to
      ? {
          ...(query.data.from
            ? { gte: new Date(`${query.data.from}T00:00:00.000Z`) }
            : {}),
          ...(query.data.to
            ? { lte: new Date(`${query.data.to}T23:59:59.999Z`) }
            : {}),
        }
      : undefined;

  const where = {
    ...scope,
    ...(query.data.practiceId ? { practiceId: query.data.practiceId } : {}),
    ...(query.data.payerName
      ? {
          payerName: {
            contains: query.data.payerName,
            mode: "insensitive" as const,
          },
        }
      : {}),
    ...(dateRange ? { batchDate: dateRange } : {}),
  };

  const [batches, total] = await Promise.all([
    prisma.eobBatch.findMany({
      where,
      orderBy: [{ batchDate: "desc" }, { postedAt: "desc" }],
      skip: pagination.skip,
      take: pagination.take,
      include: {
        practice: { select: { id: true, name: true } },
        postedBy: { select: { id: true, name: true } },
        _count: { select: { entries: true } },
      },
    }),
    prisma.eobBatch.count({ where }),
  ]);

  // Unresolved = anything not yet green.
  const unresolved = await prisma.eobEntry.groupBy({
    by: ["eobBatchId"],
    where: {
      eobBatchId: { in: batches.map((batch) => batch.id) },
      statusCategory: { not: StatusCategory.GREEN },
    },
    _count: { _all: true },
  });

  return paginatedResponse(
    batches.map((batch) => ({
      id: batch.id,
      practiceId: batch.practiceId,
      practiceName: batch.practice.name,
      payerName: batch.payerName,
      batchDate: batch.batchDate.toISOString(),
      batchReference: batch.batchReference,
      totalAmount: batch.totalAmount.toString(),
      postedByName: batch.postedBy.name,
      postedAt: batch.postedAt.toISOString(),
      entryCount: batch._count.entries,
      unresolvedCount:
        unresolved.find((row) => row.eobBatchId === batch.id)?._count._all ?? 0,
    })),
    total,
    pagination,
  );
}
