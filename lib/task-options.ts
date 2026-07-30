import { accessiblePracticeIds } from "@/lib/ar-access";
import { Role } from "@/lib/generated/prisma/enums";
import { prisma } from "@/lib/prisma";

/**
 * The dropdown contents the task pages need.
 *
 * Kept here so the three pages cannot drift apart on who may be assigned work
 * or which practices are offered.
 */

export async function taskPracticeOptions(user: { id: string; role: Role }) {
  const practiceIds = await accessiblePracticeIds(user);

  return prisma.practice.findMany({
    where: {
      isActive: true,
      ...(practiceIds === null ? {} : { id: { in: practiceIds } }),
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}

/**
 * Who this user may assign to. Billers get themselves only — the API enforces
 * the same rule, so a tampered dropdown gains nothing.
 */
export async function assignableUsersFor(user: {
  id: string;
  role: Role;
  name?: string | null;
}) {
  if (user.role === Role.BILLER) {
    return [{ id: user.id, name: user.name ?? "Me" }];
  }

  return prisma.user.findMany({
    where: {
      isActive: true,
      ...(user.role === Role.OWNER
        ? {}
        : {
            OR: [
              { id: user.id },
              {
                practices: {
                  some: { practice: { users: { some: { userId: user.id } } } },
                },
              },
            ],
          }),
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}

/** Active task types for the pickers, in the owner's chosen order. */
export async function activeTaskTypes() {
  return prisma.taskType.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true },
  });
}
