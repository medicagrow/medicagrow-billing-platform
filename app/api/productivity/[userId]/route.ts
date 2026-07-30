import { NextResponse, type NextRequest } from "next/server";
import { Role } from "@/lib/generated/prisma/enums";
import { apiErrorResponse, requireAuth } from "@/lib/api-helpers";
import { accessiblePracticeIds } from "@/lib/ar-access";
import { resolveRange } from "@/lib/productivity/date-ranges";
import { getBillerProductivity, getRecentActivity } from "@/lib/productivity";
import { getSession } from "@/lib/session";

/**
 * GET /api/productivity/[userId] — one person's activity breakdown.
 * Managers may view anyone; everyone else may view only themselves.
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
  const { from, to, preset } = resolveRange({
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

  const query = { userId: params.userId, from, to, practiceId };

  const [productivity, recentActivity] = await Promise.all([
    getBillerProductivity(query),
    getRecentActivity(query),
  ]);

  if (!productivity) {
    return apiErrorResponse("User not found.", 404);
  }

  return NextResponse.json({
    productivity,
    recentActivity,
    dateRange: { from: from.toISOString(), to: to.toISOString(), preset },
  });
}
