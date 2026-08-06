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

/**
 * 500 rows is the largest page the list views offer. It is a lot for one
 * response, but a biller reconciling a batch against a payer portal wants the
 * whole thing on one screen, and the alternative was ten trips through
 * Previous/Next.
 */
export const MAX_PAGE_SIZE = 500;

export type Pagination = {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
};

/**
 * Reads `?page` and the page size, clamped so an unbounded query is
 * impossible.
 *
 * Both `pageSize` and `limit` are accepted for the size — the list components
 * send `pageSize`, and `limit` reads more naturally from a hand-written
 * request. Anything out of range is clamped rather than rejected: a page size
 * is a display preference, and failing a whole request over one is a worse
 * answer than showing a sensible number of rows.
 */
export function parsePagination(searchParams: URLSearchParams): Pagination {
  const rawPage = Number(searchParams.get("page"));
  const rawPageSize = Number(
    searchParams.get("pageSize") ?? searchParams.get("limit"),
  );

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
