import { NextResponse, type NextRequest } from "next/server";
import { Role } from "@/lib/generated/prisma/enums";
import {
  apiErrorResponse,
  requireAuth,
  requireRole,
  zodErrorResponse,
} from "@/lib/api-helpers";
import { canAccessPractice } from "@/lib/ar-access";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { practiceProviderSchema } from "@/lib/validations/settings";

/** GET — providers on this practice's roster. */
export async function GET(
  _request: NextRequest,
  { params }: { params: { practiceId: string } },
) {
  const session = await getSession();

  const denied = requireAuth(session);
  if (denied) return denied;

  if (!(await canAccessPractice(session!.user, params.practiceId))) {
    return apiErrorResponse("Practice not found.", 404);
  }

  const providers = await prisma.practiceProvider.findMany({
    where: { practiceId: params.practiceId },
    orderBy: [{ isActive: "desc" }, { lastName: "asc" }, { firstName: "asc" }],
  });

  return NextResponse.json({
    data: providers.map((provider) => ({
      id: provider.id,
      firstName: provider.firstName,
      lastName: provider.lastName,
      npi: provider.npi,
      licenseNumber: provider.licenseNumber,
      licenseState: provider.licenseState,
      taxonomy: provider.taxonomy,
      isActive: provider.isActive,
    })),
  });
}

/** POST — add a provider. Owner only. */
export async function POST(
  request: NextRequest,
  { params }: { params: { practiceId: string } },
) {
  const session = await getSession();

  const denied = requireRole(session, [Role.OWNER]);
  if (denied) return denied;

  const practice = await prisma.practice.findUnique({
    where: { id: params.practiceId },
    select: { id: true },
  });

  if (!practice) {
    return apiErrorResponse("Practice not found.", 404);
  }

  const body = practiceProviderSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!body.success) {
    return zodErrorResponse(body.error);
  }

  // The same NPI twice on one roster is always a data-entry mistake.
  const duplicate = await prisma.practiceProvider.findFirst({
    where: { practiceId: params.practiceId, npi: body.data.npi },
    select: { id: true },
  });

  if (duplicate) {
    return apiErrorResponse(
      "A provider with that NPI is already on this roster.",
      409,
    );
  }

  const provider = await prisma.practiceProvider.create({
    data: { ...body.data, practiceId: params.practiceId },
  });

  return NextResponse.json({ provider }, { status: 201 });
}
