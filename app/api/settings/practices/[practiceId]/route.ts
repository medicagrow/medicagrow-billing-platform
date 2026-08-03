import { NextResponse, type NextRequest } from "next/server";
import { BatchStatus, Role } from "@/lib/generated/prisma/enums";
import {
  apiErrorResponse,
  requireRole,
  zodErrorResponse,
} from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { updatePracticeSchema } from "@/lib/validations/settings";

/** PATCH /api/settings/practices/[practiceId] — update or deactivate. Owner only. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { practiceId: string } },
) {
  const session = await getSession();

  const denied = requireRole(session, [Role.OWNER]);
  if (denied) return denied;

  const body = updatePracticeSchema.safeParse(
    await request.json().catch(() => null),
  );

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

  if (body.data.name) {
    const clash = await prisma.practice.findFirst({
      where: {
        id: { not: params.practiceId },
        name: { equals: body.data.name, mode: "insensitive" },
      },
      select: { id: true },
    });

    if (clash) {
      return apiErrorResponse("A practice with that name already exists.", 409);
    }
  }

  // Deactivating a practice with an open batch would strand that batch —
  // billers could no longer reach it but it would still block new uploads.
  if (existing.isActive && body.data.isActive === false) {
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
  if (body.data.primaryPmId) {
    const pm = await prisma.user.findUnique({
      where: { id: body.data.primaryPmId },
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
    data: body.data,
  });

  return NextResponse.json({ practice });
}
