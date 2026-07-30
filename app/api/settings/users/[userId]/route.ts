import { NextResponse, type NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { Role } from "@/lib/generated/prisma/enums";
import {
  apiErrorResponse,
  requireRole,
  zodErrorResponse,
} from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { updateUserSchema } from "@/lib/validations/settings";

const BCRYPT_ROUNDS = 12;

/** PATCH /api/settings/users/[userId] — update a user and sync assignments. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { userId: string } },
) {
  const session = await getSession();

  const denied = requireRole(session, [Role.OWNER]);
  if (denied) return denied;

  const body = updateUserSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!body.success) {
    return zodErrorResponse(body.error);
  }

  const input = body.data;

  const existing = await prisma.user.findUnique({
    where: { id: params.userId },
    select: { id: true, role: true, isActive: true },
  });

  if (!existing) {
    return apiErrorResponse("User not found.", 404);
  }

  const isSelf = existing.id === session!.user.id;

  // Guard against an owner locking themselves — and potentially everyone —
  // out of the platform.
  if (isSelf && input.isActive === false) {
    return apiErrorResponse("You cannot deactivate your own account.", 400);
  }

  if (isSelf && input.role && input.role !== existing.role) {
    return apiErrorResponse("You cannot change your own role.", 400);
  }

  // Never leave the platform without an active owner.
  if (
    existing.role === Role.OWNER &&
    (input.isActive === false || (input.role && input.role !== Role.OWNER))
  ) {
    const otherActiveOwners = await prisma.user.count({
      where: {
        id: { not: existing.id },
        role: Role.OWNER,
        isActive: true,
      },
    });

    if (otherActiveOwners === 0) {
      return apiErrorResponse(
        "This is the last active owner. Promote another user to Owner first.",
        409,
      );
    }
  }

  if (input.email) {
    const clash = await prisma.user.findFirst({
      where: { id: { not: params.userId }, email: input.email },
      select: { id: true },
    });

    if (clash) {
      return apiErrorResponse("A user with that email already exists.", 409);
    }
  }

  const effectiveRole = input.role ?? existing.role;

  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.email !== undefined) data.email = input.email;
  if (input.role !== undefined) data.role = input.role;
  if (input.isActive !== undefined) data.isActive = input.isActive;
  if (input.password) {
    data.hashedPassword = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: params.userId }, data });

    // Owners have implicit access to everything, so their explicit rows go.
    if (effectiveRole === Role.OWNER) {
      await tx.userPractice.deleteMany({ where: { userId: params.userId } });
      return;
    }

    if (input.practiceIds === undefined) return;

    const current = await tx.userPractice.findMany({
      where: { userId: params.userId },
      select: { practiceId: true },
    });

    const currentIds = new Set(current.map((row) => row.practiceId));
    const nextIds = new Set(input.practiceIds);

    const toRemove = Array.from(currentIds).filter((id) => !nextIds.has(id));
    const toAdd = Array.from(nextIds).filter((id) => !currentIds.has(id));

    if (toRemove.length > 0) {
      await tx.userPractice.deleteMany({
        where: { userId: params.userId, practiceId: { in: toRemove } },
      });
    }

    if (toAdd.length > 0) {
      await tx.userPractice.createMany({
        data: toAdd.map((practiceId) => ({
          userId: params.userId,
          practiceId,
          assignedById: session!.user.id,
        })),
        skipDuplicates: true,
      });
    }
  });

  const user = await prisma.user.findUnique({
    where: { id: params.userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      practices: { select: { practice: { select: { id: true, name: true } } } },
    },
  });

  return NextResponse.json({ user });
}
