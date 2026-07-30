import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import type { ZodError } from "zod";
import type { Role } from "@/lib/generated/prisma/enums";

/**
 * Every API route returns errors through these helpers so the client sees one
 * consistent error shape: { error: string, details?: unknown }.
 */

export function apiErrorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export function zodErrorResponse<T>(errors: ZodError<T>) {
  return NextResponse.json(
    { error: "Validation failed", details: errors.flatten() },
    { status: 400 },
  );
}

/**
 * Guard helpers return a NextResponse when the request should be rejected, or
 * null when it may proceed:
 *
 *   const denied = requireRole(session, ["OWNER"]);
 *   if (denied) return denied;
 */

export function requireAuth(session: Session | null): NextResponse | null {
  if (!session?.user) {
    return apiErrorResponse("Unauthorized", 401);
  }
  return null;
}

export function requireRole(
  session: Session | null,
  roles: Role[],
): NextResponse | null {
  const unauthenticated = requireAuth(session);
  if (unauthenticated) {
    return unauthenticated;
  }

  if (!roles.includes(session!.user.role)) {
    return apiErrorResponse("Forbidden", 403);
  }

  return null;
}

/* ------------------------------------------------------------------ *
 * Pagination — list endpoints are never allowed to return everything. *
 * ------------------------------------------------------------------ */

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export type Pagination = {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
};

/** Reads ?page & ?pageSize, clamped so an unbounded query is impossible. */
export function parsePagination(searchParams: URLSearchParams): Pagination {
  const rawPage = Number(searchParams.get("page"));
  const rawPageSize = Number(searchParams.get("pageSize"));

  const page =
    Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;

  const pageSize =
    Number.isFinite(rawPageSize) && rawPageSize >= 1
      ? Math.min(Math.floor(rawPageSize), MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;

  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export function paginatedResponse<T>(
  data: T[],
  total: number,
  pagination: Pagination,
) {
  return NextResponse.json({
    data,
    pagination: {
      page: pagination.page,
      pageSize: pagination.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pagination.pageSize)),
    },
  });
}
