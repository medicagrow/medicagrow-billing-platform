import { NextResponse, type NextRequest } from "next/server";
import { Role } from "@/lib/generated/prisma/enums";
import { requireRole, zodErrorResponse } from "@/lib/api-helpers";
import { arErrorResponse } from "@/lib/ar/route-errors";
import { applyQuickUpdate } from "@/lib/ar/status-requests";
import { getSession } from "@/lib/session";
import { quickUpdateSchema } from "@/lib/validations/ar";

/**
 * POST /api/ar/claims/quick-update — a manager's status change, applied now.
 *
 * Billers file the same change through `POST /api/ar/status-requests`, which
 * waits for one of these callers to approve it. Two routes rather than one
 * that branches on role, so neither path can be reached by accident.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();

  const denied = requireRole(session, [Role.OWNER, Role.PROJECT_MANAGER]);
  if (denied) return denied;

  const body = quickUpdateSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!body.success) return zodErrorResponse(body.error);

  try {
    return NextResponse.json(await applyQuickUpdate(session!.user, body.data));
  } catch (error) {
    return arErrorResponse(error);
  }
}
