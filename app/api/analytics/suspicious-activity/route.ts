import { NextResponse, type NextRequest } from "next/server";
import { Role } from "@/lib/generated/prisma/enums";
import {
  apiErrorResponse,
  requireRole,
  zodErrorResponse,
} from "@/lib/api-helpers";
import { idList, parseAnalyticsRequest } from "@/lib/analytics/request";
import {
  FLAG_TYPES,
  getSuspiciousActivity,
  type SuspiciousFlag,
} from "@/lib/analytics/suspicious-activity";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { dismissFlagSchema } from "@/lib/validations/analytics";

/** GET /api/analytics/suspicious-activity — timer behaviour worth a question. */
export async function GET(request: NextRequest) {
  const session = await getSession();

  const denied = requireRole(session, [Role.OWNER, Role.PROJECT_MANAGER]);
  if (denied) return denied;

  const parsed = await parseAnalyticsRequest(
    request.nextUrl.searchParams,
    session!.user,
  );

  if ("error" in parsed) return apiErrorResponse(parsed.error, 400);

  const requested = idList(request.nextUrl.searchParams.get("flagTypes"));

  const flagTypes = requested?.filter((flag): flag is SuspiciousFlag =>
    (FLAG_TYPES as readonly string[]).includes(flag),
  );

  const data = await getSuspiciousActivity({ ...parsed.filters, flagTypes });

  return NextResponse.json(data);
}

/**
 * POST — set a flag aside.
 *
 * Flags are recomputed from the time logs on every request, so there is
 * nothing on the flag itself to mark. What is stored is the decision to stop
 * showing it, against a key that identifies the same finding next time, and
 * with the name of whoever made it — a flag about somebody's conduct should
 * not be silently disposable.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();

  const denied = requireRole(session, [Role.OWNER, Role.PROJECT_MANAGER]);
  if (denied) return denied;

  const body = dismissFlagSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!body.success) return zodErrorResponse(body.error);

  const { flagKey, flagType, note, dismissed } = body.data;

  if (!dismissed) {
    await prisma.analyticsFlagDismissal.deleteMany({ where: { flagKey } });
    return NextResponse.json({ dismissed: false });
  }

  await prisma.analyticsFlagDismissal.upsert({
    where: { flagKey },
    create: {
      flagKey,
      flagType,
      note: note ?? null,
      dismissedById: session!.user.id,
    },
    update: { note: note ?? null, dismissedById: session!.user.id },
  });

  return NextResponse.json({ dismissed: true });
}
