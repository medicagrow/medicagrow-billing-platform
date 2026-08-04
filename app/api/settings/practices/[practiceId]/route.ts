import { NextResponse, type NextRequest } from "next/server";
import { BatchStatus, Role } from "@/lib/generated/prisma/enums";
import {
  apiErrorResponse,
  requireRole,
  zodErrorResponse,
} from "@/lib/api-helpers";
import { accessiblePracticeIds } from "@/lib/ar-access";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { updatePracticeSchema } from "@/lib/validations/settings";

/**
 * PATCH /api/settings/practices/[practiceId] — update or deactivate.
 *
 * Owners and PMs, with a PM limited to the practices they are assigned to.
 * Practice detail is the PM's own working reference — the address they bill
 * from, the NPI they quote on a call — so locking it to Owners meant every
 * correction went through a second person.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { practiceId: string } },
) {
  const session = await getSession();

  const denied = requireRole(session, [Role.OWNER, Role.PROJECT_MANAGER]);
  if (denied) return denied;

  const raw = await request.json().catch(() => null);
  const body = updatePracticeSchema.safeParse(raw);

  if (!body.success) {
    return zodErrorResponse(body.error);
  }

  const existing = await prisma.practice.findUnique({
    where: { id: params.practiceId },
    select: { id: true, isActive: true },
  });

  if (!existing) {
    return apiErrorResponse("Practice not found.", 404);
  }

  // A PM who is not on this practice is told it does not exist, matching what
  // the list and the detail page already show them.
  const accessible = await accessiblePracticeIds(session!.user);

  if (accessible !== null && !accessible.includes(params.practiceId)) {
    return apiErrorResponse("Practice not found.", 404);
  }

  /**
   * Who the primary PM is stays an Owner's decision — it decides where
   * escalations land, and a PM moving it could route another PM's work to
   * themselves. The rest of the form still saves: rejecting the whole request
   * would lose an address correction over a field the PM cannot even see.
   */
  const data = { ...body.data };
  const ignored: string[] = [];

  if (
    session!.user.role !== Role.OWNER &&
    raw !== null &&
    typeof raw === "object" &&
    "primaryPmId" in raw
  ) {
    delete data.primaryPmId;
    ignored.push("primaryPmId");
  }

  if (data.name) {
    const clash = await prisma.practice.findFirst({
      where: {
        id: { not: params.practiceId },
        name: { equals: data.name, mode: "insensitive" },
      },
      select: { id: true },
    });

    if (clash) {
      return apiErrorResponse("A practice with that name already exists.", 409);
    }
  }

  // Deactivating a practice with an open batch would strand that batch —
  // billers could no longer reach it but it would still block new uploads.
  if (existing.isActive && data.isActive === false) {
    const openBatch = await prisma.arBatch.findFirst({
      where: { practiceId: params.practiceId, status: BatchStatus.OPEN },
      select: { id: true },
    });

    if (openBatch) {
      return apiErrorResponse(
        "This practice has an open AR batch. Close the batch before deactivating the practice.",
        409,
      );
    }
  }

  /**
   * Only a project manager may be the primary PM. Escalations route here, so
   * pointing it at a biller would push practice-side questions into a queue
   * whose owner cannot answer them.
   */
  if (data.primaryPmId) {
    const pm = await prisma.user.findUnique({
      where: { id: data.primaryPmId },
      select: { role: true, isActive: true },
    });

    if (!pm || pm.role !== Role.PROJECT_MANAGER) {
      return apiErrorResponse(
        "The primary PM must be a project manager.",
        422,
      );
    }

    if (!pm.isActive) {
      return apiErrorResponse(
        "That project manager is deactivated.",
        422,
      );
    }
  }

  const practice = await prisma.practice.update({
    where: { id: params.practiceId },
    data,
  });

  // Named so the client can say what it did not save rather than implying it
  // saved everything.
  return NextResponse.json({ practice, ignoredFields: ignored });
}
