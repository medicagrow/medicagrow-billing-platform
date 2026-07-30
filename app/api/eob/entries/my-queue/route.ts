import { NextResponse, type NextRequest } from "next/server";
import {
  Role,
  StatusCategory,
  type EobEntryType,
} from "@/lib/generated/prisma/enums";
import { parsePagination, requireAuth } from "@/lib/api-helpers";
import { EOB_ENTRY_INCLUDE, toEobEntryDto } from "@/lib/eob-serialize";
import { centsToDecimalString, toCents } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

/**
 * GET /api/eob/entries/my-queue — the biller's EOB worklist.
 *
 * Same scoping contract as the AR queue, enforced in one query:
 *   1. assigned to the caller
 *   2. RED (unresolved, action pending)
 *   3. the batch's practice is one the caller is assigned to
 *
 * Owners hold implicit access to every practice and have no UserPractice
 * rows, so the join would empty their queue — they skip rule 3.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();

  const denied = requireAuth(session);
  if (denied) return denied;

  const searchParams = request.nextUrl.searchParams;
  const pagination = parsePagination(searchParams);

  const practiceId = searchParams.get("practiceId") ?? undefined;
  const entryType = searchParams.get("entryType") ?? undefined;

  const practiceScope =
    session!.user.role === Role.OWNER
      ? {}
      : { practice: { users: { some: { userId: session!.user.id } } } };

  const where = {
    assignedToId: session!.user.id,
    statusCategory: StatusCategory.RED,
    batch: {
      ...practiceScope,
      ...(practiceId ? { practiceId } : {}),
    },
    ...(entryType === "DENIAL" || entryType === "REJECTION"
      ? { entryType: entryType as EobEntryType }
      : {}),
  };

  const [entries, total] = await Promise.all([
    prisma.eobEntry.findMany({
      where,
      // Oldest date of service first: those are closest to timely-filing limits.
      orderBy: [{ dateOfService: "asc" }, { patientName: "asc" }],
      skip: pagination.skip,
      take: pagination.take,
      include: {
        ...EOB_ENTRY_INCLUDE,
        batch: {
          select: {
            payerName: true,
            practice: { select: { id: true, name: true } },
          },
        },
      },
    }),
    prisma.eobEntry.count({ where }),
  ]);

  // Total denied amount across the whole queue, not just this page.
  const atRisk = await prisma.eobEntry.findMany({
    where,
    select: { deniedAmount: true },
  });

  let cents = 0n;
  for (const entry of atRisk) {
    cents += toCents(entry.deniedAmount?.toString() ?? "0");
  }

  return NextResponse.json({
    data: entries.map(toEobEntryDto),
    pagination: {
      page: pagination.page,
      pageSize: pagination.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pagination.pageSize)),
    },
    summary: {
      totalEntries: total,
      totalDeniedAmount: centsToDecimalString(cents),
    },
  });
}
