import { NextResponse, type NextRequest } from "next/server";
import { parsePagination, requireAuth } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

/** GET /api/ar/denial-reasons — autocomplete source, most-used first. */
export async function GET(request: NextRequest) {
  const session = await getSession();

  const denied = requireAuth(session);
  if (denied) return denied;

  const search = request.nextUrl.searchParams.get("q")?.trim();
  const pagination = parsePagination(request.nextUrl.searchParams);

  const where = search
    ? { reason: { contains: search, mode: "insensitive" as const } }
    : {};

  const [reasons, total] = await Promise.all([
    prisma.arDenialReason.findMany({
      where,
      orderBy: [{ usageCount: "desc" }, { reason: "asc" }],
      skip: pagination.skip,
      take: pagination.take,
    }),
    prisma.arDenialReason.count({ where }),
  ]);

  return NextResponse.json({
    data: reasons.map((reason) => ({
      id: reason.id,
      reason: reason.reason,
      usageCount: reason.usageCount,
      lastUsedAt: reason.lastUsedAt?.toISOString() ?? null,
      createdAt: reason.createdAt.toISOString(),
    })),
    pagination: {
      page: pagination.page,
      pageSize: pagination.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pagination.pageSize)),
    },
  });
}
