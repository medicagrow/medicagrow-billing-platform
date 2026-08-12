import { NextResponse, type NextRequest } from "next/server";
import { Role } from "@/lib/generated/prisma/enums";
import { apiErrorResponse, requireRole } from "@/lib/api-helpers";
import { accessiblePracticeIds } from "@/lib/ar-access";
import { parseAnalyticsRequest } from "@/lib/analytics/request";
import { getWorkloadData } from "@/lib/analytics/workload";
import { getSession } from "@/lib/session";

/** The two working days the team actually uses. */
const TARGETS = [7.5, 8];

/** GET /api/analytics/workload — who is booked, who is free, by day. */
export async function GET(request: NextRequest) {
  const session = await getSession();

  const denied = requireRole(session, [Role.OWNER, Role.PROJECT_MANAGER]);
  if (denied) return denied;

  const parsed = await parseAnalyticsRequest(
    request.nextUrl.searchParams,
    session!.user,
  );

  if ("error" in parsed) return apiErrorResponse(parsed.error, 400);

  const requested = Number(request.nextUrl.searchParams.get("targetHours"));

  // An arbitrary target would make the colours meaningless, so anything else
  // falls back rather than being honoured.
  const targetHoursPerDay = TARGETS.includes(requested) ? requested : 7.5;

  const data = await getWorkloadData({
    from: parsed.filters.from,
    to: parsed.filters.to,
    practiceIds: parsed.filters.practiceIds,
    userIds: parsed.filters.billerIds,
    targetHoursPerDay,
    /**
     * Separate from the practice *filter*. AR load is shown whatever practice
     * it belongs to — a biller's day is consumed by all of it — and this only
     * decides which blocks are labelled as another PM's work.
     */
    viewerPracticeIds: await accessiblePracticeIds(session!.user),
  });

  return NextResponse.json(data);
}
