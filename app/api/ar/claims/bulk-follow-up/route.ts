import { NextResponse, type NextRequest } from "next/server";
import { requireAuth, zodErrorResponse } from "@/lib/api-helpers";
import { arErrorResponse } from "@/lib/ar/route-errors";
import { bulkSetFollowUp } from "@/lib/ar/status-requests";
import { getSession } from "@/lib/session";
import { bulkFollowUpSchema } from "@/lib/validations/ar";

/**
 * POST /api/ar/claims/bulk-follow-up — one follow-up date on many claims.
 *
 * No approval step: a follow-up date is scheduling, not a verdict on the
 * claim. Billers are held to their own claims inside `bulkSetFollowUp`.
 */
export async function POST(request: NextRequest) {
  const session = await getSession();

  const denied = requireAuth(session);
  if (denied) return denied;

  const body = bulkFollowUpSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!body.success) return zodErrorResponse(body.error);

  try {
    return NextResponse.json(await bulkSetFollowUp(session!.user, body.data));
  } catch (error) {
    return arErrorResponse(error);
  }
}
