import { NextResponse, type NextRequest } from "next/server";
import { Role } from "@/lib/generated/prisma/enums";
import {
  apiErrorResponse,
  requireRole,
  zodErrorResponse,
} from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { updatePracticeProviderSchema } from "@/lib/validations/settings";

/** PATCH — update or deactivate a roster provider. Owner only. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { practiceId: string; providerId: string } },
) {
  const session = await getSession();

  const denied = requireRole(session, [Role.OWNER]);
  if (denied) return denied;

  const existing = await prisma.practiceProvider.findUnique({
    where: { id: params.providerId },
    select: { id: true, practiceId: true },
  });

  if (!existing || existing.practiceId !== params.practiceId) {
    return apiErrorResponse("Provider not found.", 404);
  }

  const body = updatePracticeProviderSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!body.success) {
    return zodErrorResponse(body.error);
  }

  if (body.data.npi) {
    const duplicate = await prisma.practiceProvider.findFirst({
      where: {
        id: { not: params.providerId },
        practiceId: params.practiceId,
        npi: body.data.npi,
      },
      select: { id: true },
    });

    if (duplicate) {
      return apiErrorResponse(
        "Another provider on this roster already has that NPI.",
        409,
      );
    }
  }

  const provider = await prisma.practiceProvider.update({
    where: { id: params.providerId },
    data: body.data,
  });

  return NextResponse.json({ provider });
}
