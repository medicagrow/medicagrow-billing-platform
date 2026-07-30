import { NextResponse, type NextRequest } from "next/server";
import { Role } from "@/lib/generated/prisma/enums";
import { requireRole } from "@/lib/api-helpers";
import { accessiblePracticeIds } from "@/lib/ar-access";
import { resolveRange } from "@/lib/productivity/date-ranges";
import { getTeamProductivity } from "@/lib/productivity";
import { getSession } from "@/lib/session";

/** GET /api/productivity/team — activity for every biller and PM in range. */
export async function GET(request: NextRequest) {
  const session = await getSession();

  const denied = requireRole(session, [Role.OWNER, Role.PROJECT_MANAGER]);
  if (denied) return denied;

  const searchParams = request.nextUrl.searchParams;
  const { from, to, preset } = resolveRange({
    preset: searchParams.get("preset"),
    from: searchParams.get("from"),
    to: searchParams.get("to"),
  });

  const practiceIds = await accessiblePracticeIds(session!.user);

  // Ignore a practiceId the caller cannot see rather than trusting it.
  const requested = searchParams.get("practiceId") ?? undefined;
  const practiceId =
    requested && (practiceIds === null || practiceIds.includes(requested))
      ? requested
      : undefined;

  const team = await getTeamProductivity({
    from,
    to,
    practiceId,
    practiceIds,
  });

  return NextResponse.json({
    data: team,
    dateRange: {
      from: from.toISOString(),
      to: to.toISOString(),
      preset,
    },
    practiceId: practiceId ?? null,
  });
}
