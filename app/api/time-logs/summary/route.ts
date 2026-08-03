import { NextResponse, type NextRequest } from "next/server";
import { apiErrorResponse, requireRole } from "@/lib/api-helpers";
import { accessiblePracticeIds } from "@/lib/ar-access";
import { getSession } from "@/lib/session";
import { getTimeLogSummary } from "@/lib/time-analysis";
import { parseTimeLogFilters } from "@/lib/validations/time-logs";

/** GET /api/time-logs/summary — aggregated time and efficiency. */
export async function GET(request: NextRequest) {
  const session = await getSession();

  const denied = requireRole(session, ["OWNER", "PROJECT_MANAGER"]);
  if (denied) return denied;

  const parsed = parseTimeLogFilters(request.nextUrl.searchParams);

  if ("error" in parsed) {
    return apiErrorResponse(parsed.error, 400);
  }

  /**
   * A PM sees their own practices' time. Narrowing the requested list against
   * what they may see stops a hand-edited query string widening the scope.
   */
  const allowed = await accessiblePracticeIds(session!.user);

  const practiceIds =
    allowed === null
      ? parsed.filters.practiceIds
      : parsed.filters.practiceIds && parsed.filters.practiceIds.length > 0
        ? parsed.filters.practiceIds.filter((id) => allowed.includes(id))
        : allowed;

  const summary = await getTimeLogSummary({ ...parsed.filters, practiceIds });

  return NextResponse.json(summary);
}
