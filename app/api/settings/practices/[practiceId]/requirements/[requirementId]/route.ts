import { NextResponse, type NextRequest } from "next/server";
import { Role } from "@/lib/generated/prisma/enums";
import { apiErrorResponse, requireRole } from "@/lib/api-helpers";
import { accessiblePracticeIds } from "@/lib/ar-access";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

/**
 * DELETE — remove a requirement.
 *
 * Deleting means "we no longer commit to a number here", which is different
 * from setting it to zero: zero says the work is not required, absent says
 * nobody has decided. The resource report reads the two differently.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { practiceId: string; requirementId: string } },
) {
  const session = await getSession();

  const denied = requireRole(session, [Role.OWNER, Role.PROJECT_MANAGER]);
  if (denied) return denied;

  const accessible = await accessiblePracticeIds(session!.user);

  if (accessible !== null && !accessible.includes(params.practiceId)) {
    return apiErrorResponse("Requirement not found.", 404);
  }

  const existing = await prisma.practiceRequirement.findUnique({
    where: { id: params.requirementId },
    select: { id: true, practiceId: true },
  });

  // The id must belong to the practice in the path, or a requirement could be
  // deleted through a practice the caller happens to have access to.
  if (!existing || existing.practiceId !== params.practiceId) {
    return apiErrorResponse("Requirement not found.", 404);
  }

  await prisma.practiceRequirement.delete({
    where: { id: params.requirementId },
  });

  return NextResponse.json({ deleted: true });
}
