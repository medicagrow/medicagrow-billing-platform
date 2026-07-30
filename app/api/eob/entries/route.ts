import type { NextRequest } from "next/server";
import type { Prisma } from "@/lib/generated/prisma/client";
import { StatusCategory } from "@/lib/generated/prisma/enums";
import {
  paginatedResponse,
  parsePagination,
  requireAuth,
  zodErrorResponse,
} from "@/lib/api-helpers";
import { accessiblePracticeIds } from "@/lib/ar-access";
import {
  EOB_BATCH_SELECT,
  EOB_ENTRY_INCLUDE,
  toEobEntryDto,
} from "@/lib/eob-serialize";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { listEobEntriesQuerySchema } from "@/lib/validations/eob";

/** GET /api/eob/entries — entries across batches, scoped to the caller. */
export async function GET(request: NextRequest) {
  const session = await getSession();

  const denied = requireAuth(session);
  if (denied) return denied;

  const searchParams = request.nextUrl.searchParams;

  const query = listEobEntriesQuerySchema.safeParse({
    practiceId: searchParams.get("practiceId") ?? undefined,
    batchId: searchParams.get("batchId") ?? undefined,
    entryType: searchParams.get("entryType") ?? undefined,
    statusCategory: searchParams.get("statusCategory") ?? undefined,
    assignedToId: searchParams.get("assignedToId") ?? undefined,
    unresolved: searchParams.get("unresolved") ?? undefined,
    payerName: searchParams.get("payerName") ?? undefined,
    from: searchParams.get("from") ?? undefined,
    to: searchParams.get("to") ?? undefined,
    sort: searchParams.get("sort") ?? undefined,
    direction: searchParams.get("direction") ?? undefined,
  });

  if (!query.success) {
    return zodErrorResponse(query.error);
  }

  const filters = query.data;
  const pagination = parsePagination(searchParams);
  const practiceIds = await accessiblePracticeIds(session!.user);

  // The range bounds the batch date — when the remittance arrived — not the
  // date of service. "Show me last month's ERAs" means the former.
  const batchDateRange =
    filters.from || filters.to
      ? {
          ...(filters.from
            ? { gte: new Date(`${filters.from}T00:00:00.000Z`) }
            : {}),
          ...(filters.to
            ? { lte: new Date(`${filters.to}T23:59:59.999Z`) }
            : {}),
        }
      : undefined;

  const where = {
    batch: {
      ...(practiceIds === null ? {} : { practiceId: { in: practiceIds } }),
      ...(filters.practiceId ? { practiceId: filters.practiceId } : {}),
      ...(filters.payerName
        ? {
            payerName: {
              contains: filters.payerName,
              mode: "insensitive" as const,
            },
          }
        : {}),
      ...(batchDateRange ? { batchDate: batchDateRange } : {}),
    },
    ...(filters.batchId ? { eobBatchId: filters.batchId } : {}),
    ...(filters.entryType ? { entryType: filters.entryType } : {}),
    ...(filters.statusCategory
      ? { statusCategory: filters.statusCategory }
      : {}),
    ...(filters.assignedToId ? { assignedToId: filters.assignedToId } : {}),
    ...(filters.unresolved === "true"
      ? { statusCategory: { not: StatusCategory.GREEN } }
      : {}),
  };

  // Newest remittance first is the working order; everything else is opt-in.
  const direction = filters.direction ?? (filters.sort ? "asc" : "desc");

  const orderBy: Prisma.EobEntryOrderByWithRelationInput[] =
    filters.sort === "deniedAmount"
      ? [{ deniedAmount: { sort: direction, nulls: "last" } }]
      : filters.sort === "patientName"
        ? [{ patientName: direction }]
        : filters.sort === "payerName"
          ? [{ batch: { payerName: direction } }]
          : filters.sort === "status"
            ? [{ statusCategory: direction }, { statusLabel: direction }]
            : [{ batch: { batchDate: direction } }];

  const [entries, total] = await Promise.all([
    prisma.eobEntry.findMany({
      where,
      orderBy: [...orderBy, { patientName: "asc" }],
      skip: pagination.skip,
      take: pagination.take,
      include: { ...EOB_ENTRY_INCLUDE, batch: EOB_BATCH_SELECT },
    }),
    prisma.eobEntry.count({ where }),
  ]);

  return paginatedResponse(entries.map(toEobEntryDto), total, pagination);
}
