import { NextResponse, type NextRequest } from "next/server";
import { Role } from "@/lib/generated/prisma/enums";
import { requireRole, zodErrorResponse } from "@/lib/api-helpers";
import { arErrorResponse } from "@/lib/ar/route-errors";
import { reviewStatusRequest } from "@/lib/ar/status-requests";
import { getSession } from "@/lib/session";
import { reviewStatusRequestSchema } from "@/lib/validations/ar";

/**
 * PATCH /api/ar/status-requests/[requestId]/review — decide some or all of a
 * request's claims.
 *
 * Only the claims marked APPROVED change status. Undecided claims stay pending
 * and the request stays open for them.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { requestId: string } },
) {
  const session = await getSession();

  const denied = requireRole(session, [Role.OWNER, Role.PROJECT_MANAGER]);
  if (denied) return denied;

  const body = reviewStatusRequestSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!body.success) return zodErrorResponse(body.error);

  try {
    return NextResponse.json(
      await reviewStatusRequest(
        // The name goes into the approved note's text, so it must be a string.
        { ...session!.user, name: session!.user.name ?? "a manager" },
        params.requestId,
        body.data.items,
      ),
    );
  } catch (error) {
    return arErrorResponse(error);
  }
}
