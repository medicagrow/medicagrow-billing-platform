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
import { createUserSchema } from "@/lib/validations/settings";

const BCRYPT_ROUNDS = 12;

/** GET /api/settings/users — users with their practice assignments. Owner only. */
export async function GET() {
  const session = await getSession();

  const denied = requireRole(session, [Role.OWNER]);
  if (denied) return denied;

  const users = await prisma.user.findMany({
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isActive: true,
      createdAt: true,
      practices: {
        select: { practice: { select: { id: true, name: true } } },
      },
    },
  });

  return NextResponse.json({
    data: users.map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      createdAt: user.createdAt.toISOString(),
      practices: user.practices.map((entry) => entry.practice),
    })),
  });
}

/** POST /api/settings/users — create a user and their practice assignments. */
export async function POST(request: NextRequest) {
  const session = await getSession();

  const denied = requireRole(session, [Role.OWNER]);
  if (denied) return denied;

  const body = createUserSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!body.success) {
    return zodErrorResponse(body.error);
  }

  const input = body.data;

  const existing = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });

  if (existing) {
    return apiErrorResponse("A user with that email already exists.", 409);
  }

  if (input.practiceIds.length > 0) {
    const found = await prisma.practice.count({
      where: { id: { in: input.practiceIds } },
    });

    if (found !== input.practiceIds.length) {
      return apiErrorResponse("One or more practices no longer exist.", 400);
    }
  }

  const hashedPassword = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

  const user = await prisma.user.create({
    data: {
      name: input.name,
      email: input.email,
      hashedPassword,
      role: input.role,
      isActive: input.isActive,
      practices: {
        create: input.practiceIds.map((practiceId) => ({
          practiceId,
          assignedById: session!.user.id,
        })),
      },
    },
    select: { id: true, name: true, email: true, role: true, isActive: true },
  });

  return NextResponse.json({ user }, { status: 201 });
}
