import { Role } from "@/lib/generated/prisma/enums";
import { prisma } from "@/lib/prisma";

/**
 * Practice scoping (build spec §12.2). OWNER sees every practice; everyone
 * else only sees practices they hold a UserPractice record for.
 */

export interface SessionUserLike {
  id: string;
  role: Role;
}

export function isOwner(user: SessionUserLike) {
  return user.role === Role.OWNER;
}

export function canManageBatches(user: SessionUserLike) {
  return user.role === Role.OWNER || user.role === Role.PROJECT_MANAGER;
}

/** Practice ids this user may touch, or null meaning "all practices". */
export async function accessiblePracticeIds(
  user: SessionUserLike,
): Promise<string[] | null> {
  if (isOwner(user)) return null;

  const assignments = await prisma.userPractice.findMany({
    where: { userId: user.id },
    select: { practiceId: true },
  });

  return assignments.map((assignment) => assignment.practiceId);
}

/**
 * Prisma `where` fragment scoping a query on ArBatch to the user's practices.
 * Returns {} for OWNER.
 */
export async function practiceScopeFilter(user: SessionUserLike) {
  const ids = await accessiblePracticeIds(user);
  return ids === null ? {} : { practiceId: { in: ids } };
}

export async function canAccessPractice(
  user: SessionUserLike,
  practiceId: string,
): Promise<boolean> {
  if (isOwner(user)) return true;

  const assignment = await prisma.userPractice.findUnique({
    where: { userId_practiceId: { userId: user.id, practiceId } },
    select: { id: true },
  });

  return assignment !== null;
}

export async function canAccessBatch(
  user: SessionUserLike,
  batchId: string,
): Promise<boolean> {
  const batch = await prisma.arBatch.findUnique({
    where: { id: batchId },
    select: { practiceId: true },
  });

  if (!batch) return false;

  return canAccessPractice(user, batch.practiceId);
}
