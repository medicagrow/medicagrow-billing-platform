import { NextResponse, type NextRequest } from "next/server";
import { Role } from "@/lib/generated/prisma/enums";
import {
  apiErrorResponse,
  requireAuth,
  requireRole,
  zodErrorResponse,
} from "@/lib/api-helpers";
import { accessiblePracticeIds } from "@/lib/ar-access";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { practiceSchema } from "@/lib/validations/settings";

/**
 * GET /api/settings/practices — practices for pickers and admin lists.
 *
 * Scoped to what the caller may see: an Owner gets every practice, everyone
 * else gets the ones they are assigned to. A PM administering a practice they
 * do not manage is not a thing this platform allows, so it should not be in
 * their list to begin with.
 */
export async function GET() {
  const session = await getSession();

  const denied = requireAuth(session);
  if (denied) return denied;

  const practiceIds = await accessiblePracticeIds(session!.user);

  const practices = await prisma.practice.findMany({
    where: practiceIds === null ? {} : { id: { in: practiceIds } },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      ehrSource: true,
      isActive: true,
      createdAt: true,
      _count: { select: { arBatches: true, users: true } },
      primaryPm: { select: { name: true } },
    },
  });

  return NextResponse.json({
    data: practices.map((practice) => ({
      id: practice.id,
      name: practice.name,
      ehrSource: practice.ehrSource,
      isActive: practice.isActive,
      createdAt: practice.createdAt.toISOString(),
      batchCount: practice._count.arBatches,
      userCount: practice._count.users,
      primaryPmName: practice.primaryPm?.name ?? null,
    })),
  });
}

/** POST /api/settings/practices — create a practice. Owner only. */
export async function POST(request: NextRequest) {
  const session = await getSession();

  const denied = requireRole(session, [Role.OWNER]);
  if (denied) return denied;

  const body = practiceSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!body.success) {
    return zodErrorResponse(body.error);
  }

  const existing = await prisma.practice.findFirst({
    where: { name: { equals: body.data.name, mode: "insensitive" } },
    select: { id: true },
  });

  if (existing) {
    return apiErrorResponse("A practice with that name already exists.", 409);
  }

  const practice = await prisma.practice.create({ data: body.data });

  return NextResponse.json({ practice }, { status: 201 });
}
