import { Role } from "@/lib/generated/prisma/enums";
import { prisma } from "@/lib/prisma";

/**
 * Task visibility:
 *   Biller — tasks assigned to them, plus tasks they created and chose to keep
 *            sight of (`isVisibleToCreator`).
 *   PM     — the above, plus everything belonging to their practices.
 *   Owner  — everything.
 *
 * PMs need the practice list resolved first, so this is async where the todo
 * equivalent is not.
 */
export async function taskVisibilityFilter(user: {
  id: string;
  role: Role;
}): Promise<Record<string, unknown>> {
  if (user.role === Role.OWNER) return {};

  const own = [
    { assignedToId: user.id },
    { createdById: user.id, isVisibleToCreator: true },
  ];

  if (user.role !== Role.PROJECT_MANAGER) return { OR: own };

  const memberships = await prisma.userPractice.findMany({
    where: { userId: user.id },
    select: { practiceId: true },
  });

  const practiceIds = memberships.map((row) => row.practiceId);

  return {
    OR: [
      ...own,
      ...(practiceIds.length > 0
        ? [{ practiceId: { in: practiceIds } }]
        : []),
      // A PM also oversees whoever shares one of their practices, including
      // work that carries no practice of its own.
      {
        assignedTo: {
          practices: { some: { practiceId: { in: practiceIds } } },
        },
      },
    ],
  };
}

/** Who this user may assign a task to. */
export async function canAssignTask(
  user: { id: string; role: Role },
  assigneeId: string,
): Promise<boolean> {
  if (assigneeId === user.id) return true;
  if (user.role === Role.OWNER) return true;

  if (user.role === Role.PROJECT_MANAGER) {
    const shared = await prisma.userPractice.findFirst({
      where: {
        userId: assigneeId,
        practice: { users: { some: { userId: user.id } } },
      },
      select: { id: true },
    });

    return shared !== null;
  }

  // Billers create work for themselves only.
  return false;
}

/**
 * Editing is allowed for the assignee, the creator, or an owner. A PM who
 * merely oversees the practice can see the task but not rewrite someone
 * else's — they reassign it instead.
 */
export function canEditTask(
  user: { id: string; role: Role },
  task: { assignedToId: string; createdById: string },
): boolean {
  return (
    user.role === Role.OWNER ||
    task.assignedToId === user.id ||
    task.createdById === user.id
  );
}
