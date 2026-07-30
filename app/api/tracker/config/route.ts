import { NextResponse, type NextRequest } from "next/server";
import {
  requireAuth,
  requireRole,
  zodErrorResponse,
} from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import {
  CONFIG_KEYS,
  getTrackerConfig,
  invalidateTrackerConfigCache,
} from "@/lib/tracker/config";
import { updateTrackerConfigSchema } from "@/lib/validations/tracker-config";

/** GET /api/tracker/config — the weights and bands scoring currently uses. */
export async function GET() {
  const session = await getSession();

  const denied = requireAuth(session);
  if (denied) return denied;

  const config = await getTrackerConfig();

  return NextResponse.json(config);
}

/** PATCH /api/tracker/config — owner-only retune of the scoring model. */
export async function PATCH(request: NextRequest) {
  const session = await getSession();

  const denied = requireRole(session, ["OWNER"]);
  if (denied) return denied;

  const body = updateTrackerConfigSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!body.success) {
    return zodErrorResponse(body.error);
  }

  const { weights, ranges } = body.data;

  const writes = [
    ...(weights
      ? [{ key: CONFIG_KEYS.WEIGHTS, value: weights as object }]
      : []),
    ...(ranges
      ? [{ key: CONFIG_KEYS.RANGES, value: ranges as unknown as object }]
      : []),
  ];

  await prisma.$transaction(
    writes.map(({ key, value }) =>
      prisma.trackerConfig.upsert({
        where: { configKey: key },
        create: {
          configKey: key,
          configValue: value,
          updatedById: session!.user.id,
        },
        update: { configValue: value, updatedById: session!.user.id },
      }),
    ),
  );

  // Scoring caches config for five minutes; a save must take effect now.
  invalidateTrackerConfigCache();

  return NextResponse.json(await getTrackerConfig());
}
