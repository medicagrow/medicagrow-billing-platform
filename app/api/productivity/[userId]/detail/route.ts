import { NextResponse, type NextRequest } from "next/server";
import { Role } from "@/lib/generated/prisma/enums";
import {
  apiErrorResponse,
  parsePagination,
  requireAuth,
} from "@/lib/api-helpers";
import { accessiblePracticeIds } from "@/lib/ar-access";
import { resolveRange } from "@/lib/productivity/date-ranges";
import { getActivityDetail } from "@/lib/productivity";
import { getSession } from "@/lib/session";

/**
 * GET /api/productivity/[userId]/detail — the records behind one activity.
 * Whichever module owns the activity key returns its own row shape.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { userId: string } },
) {
  const session = await getSession();

  const denied = requireAuth(session);
  if (denied) return denied;

  const isManager =
    session!.user.role === Role.OWNER ||
    session!.user.role === Role.PROJECT_MANAGER;

  if (!isManager && session!.user.id !== params.userId) {
    return apiErrorResponse("You can only view your own productivity.", 403);
  }

  const searchParams = request.nextUrl.searchParams;
  const activityKey = searchParams.get("activity");

  if (!activityKey) {
    return apiErrorResponse("An activity is required.", 400);
  }

  const { from, to } = resolveRange({
    preset: searchParams.get("preset"),
    from: searchParams.get("from"),
    to: searchParams.get("to"),
  });

  const practiceIds = await accessiblePracticeIds(session!.user);
  const requested = searchParams.get("practiceId") ?? undefined;
  const practiceId =
    requested && (practiceIds === null || practiceIds.includes(requested))
      ? requested
      : undefined;

  const pagination = parsePagination(searchParams);

  const page = await getActivityDetail({
    userId: params.userId,
    from,
    to,
    practiceId,
    activityKey,
    skip: pagination.skip,
    take: pagination.take,
  });

  if (!page) {
    return apiErrorResponse(`Unknown activity "${activityKey}".`, 400);
  }

  return NextResponse.json({
    ...page,
    dateRange: { from: from.toISOString(), to: to.toISOString() },
  });
}
