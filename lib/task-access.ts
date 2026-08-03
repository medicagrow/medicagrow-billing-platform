import { Role } from "@/lib/generated/prisma/enums";
import { prisma } from "@/lib/prisma";

/** Practices this user is a member of. Owners hold no rows and get []. */
export async function practiceMembershipIds(userId: string): Promise<string[]> {
  const memberships = await prisma.userPractice.findMany({
    where: { userId },
    select: { practiceId: true },
  });

  return memberships.map((row) => row.practiceId);
}

/**
 * Task visibility:
 *   Biller — tasks assigned to them, plus tasks they created and chose to keep
 *            sight of (`isVisibleToCreator`).
 *   PM     — the above, plus tasks **belonging to their practices**, plus
 *            general tasks (no practice) held by someone who shares one of
 *            those practices.
 *   Owner  — everything.
 *
 * A PM's scope is the practice, not the person. Someone who works five
 * practices is overseen by five PMs, and each of them may only see the part
 * that is theirs — a shared biller must not carry another practice's work into
 * this list.
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

  const practiceIds = await practiceMembershipIds(user.id);

  if (practiceIds.length === 0) return { OR: own };

  return {
    OR: [
      ...own,
      { practiceId: { in: practiceIds } },
      // A general task carries no practice of its own, so it is placed by who
      // holds it: someone the PM shares a practice with.
      {
        practiceId: null,
        assignedTo: {
          practices: { some: { practiceId: { in: practiceIds } } },
        },
      },
    ],
  };
}

/**
 * Which of a team member's tasks this viewer may count.
 *
 * The Team page lists people first and their workload second, so the counts
 * need the same practice scope the task list uses — otherwise a biller shared
 * with another practice shows totals the PM cannot open.
 */
export function teamTaskScope({
  accessiblePracticeIds,
  selectedPracticeIds,
}: {
  /** null for an Owner: every practice. */
  accessiblePracticeIds: string[] | null;
  /** The page's practice filter, if the viewer set one. */
  selectedPracticeIds: string[];
}): Record<string, unknown> {
  if (selectedPracticeIds.length > 0) {
    return { practiceId: { in: selectedPracticeIds } };
  }

  if (accessiblePracticeIds === null) return {};

  return {
    OR: [
      { practiceId: { in: accessiblePracticeIds } },
      { practiceId: null },
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
