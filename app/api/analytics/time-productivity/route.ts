import { NextResponse, type NextRequest } from "next/server";
import { Role } from "@/lib/generated/prisma/enums";
import { apiErrorResponse, requireRole } from "@/lib/api-helpers";
import { parseAnalyticsRequest } from "@/lib/analytics/request";
import {
  getTimeProductivityData,
  type GroupDimension,
} from "@/lib/analytics/time-productivity";
import { getSession } from "@/lib/session";

const DIMENSIONS: GroupDimension[] = ["biller", "practice", "taskType"];

/** GET /api/analytics/time-productivity — time against output, nested. */
export async function GET(request: NextRequest) {
  const session = await getSession();

  const denied = requireRole(session, [Role.OWNER, Role.PROJECT_MANAGER]);
  if (denied) return denied;

  const parsed = await parseAnalyticsRequest(
    request.nextUrl.searchParams,
    session!.user,
  );

  if ("error" in parsed) return apiErrorResponse(parsed.error, 400);

  const requested = request.nextUrl.searchParams.get("groupBy");

  const groupBy: GroupDimension = DIMENSIONS.includes(
    requested as GroupDimension,
  )
    ? (requested as GroupDimension)
    : "biller";

  const data = await getTimeProductivityData({ ...parsed.filters, groupBy });

  return NextResponse.json(data);
}
