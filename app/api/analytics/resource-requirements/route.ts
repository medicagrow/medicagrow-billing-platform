import { NextResponse, type NextRequest } from "next/server";
import { Role } from "@/lib/generated/prisma/enums";
import { apiErrorResponse, requireRole } from "@/lib/api-helpers";
import { idList, narrowPractices } from "@/lib/analytics/request";
import { getResourceRequirementsData } from "@/lib/analytics/resource-requirements";
import { getSession } from "@/lib/session";

/**
 * GET /api/analytics/resource-requirements — what each practice needs this
 * month against what has been booked.
 *
 * A month rather than a free range: requirements are set per month, and
 * measuring a commitment over eleven days would compare unlike things.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();

  const denied = requireRole(session, [Role.OWNER, Role.PROJECT_MANAGER]);
  if (denied) return denied;

  const params = request.nextUrl.searchParams;
  const now = new Date();

  const month = Number(params.get("month") ?? now.getUTCMonth() + 1);
  const year = Number(params.get("year") ?? now.getUTCFullYear());

  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return apiErrorResponse("Month must be 1–12.", 400);
  }

  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return apiErrorResponse("That year looks wrong.", 400);
  }

  const practiceIds = await narrowPractices(
    idList(params.get("practiceIds")),
    session!.user,
  );

  const data = await getResourceRequirementsData({ month, year, practiceIds });

  return NextResponse.json(data);
}
