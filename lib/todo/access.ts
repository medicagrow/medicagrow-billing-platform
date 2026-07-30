import { Role, TodoStatus } from "@/lib/generated/prisma/enums";
import { prisma } from "@/lib/prisma";

/**
 * Todo visibility:
 *   PM    — assigned to them, sub-assigned to them, or created by them and
 *           shared out.
 *   Owner — everything.
 *
 * To Dos are personal planning for the people who run the operation, so a
 * todo assigned away is out of the creator's list unless they marked it
 * shared. Billers do not have the module; the branch below is a floor, not a
 * feature.
 */
export function todoVisibilityFilter(user: { id: string; role: Role }) {
  if (user.role === Role.OWNER) return {};

  const mine = [
    { assignedToId: user.id },
    { subAssignedToId: user.id },
  ];

  if (user.role === Role.PROJECT_MANAGER) {
    return {
      OR: [...mine, { createdById: user.id, isShared: true }],
    };
  }

  return { OR: mine };
}

/** Who this user may assign work to. */
export async function canAssignTo(
  user: { id: string; role: Role },
  assigneeId: string,
): Promise<boolean> {
  if (assigneeId === user.id) return true;
  if (user.role === Role.OWNER) return true;

  if (user.role === Role.PROJECT_MANAGER) {
    // A PM may assign to anyone who shares one of their practices.
    const shared = await prisma.userPractice.findFirst({
      where: {
        userId: assigneeId,
        practice: { users: { some: { userId: user.id } } },
      },
      select: { id: true },
    });

    return shared !== null;
  }

  // Billers may only create work for themselves.
  return false;
}

/** Editing is allowed for the assignee, the sub-assignee, the creator, or an owner. */
export function canEditTodo(
  user: { id: string; role: Role },
  todo: {
    assignedToId: string;
    createdById: string;
    subAssignedToId?: string | null;
  },
): boolean {
  return (
    user.role === Role.OWNER ||
    todo.assignedToId === user.id ||
    todo.subAssignedToId === user.id ||
    todo.createdById === user.id
  );
}

export const OPEN_STATUSES = [TodoStatus.OPEN, TodoStatus.IN_PROCESS];

/** UTC midnight for a YYYY-MM-DD string, or today when omitted. */
export function dayStart(date?: string): Date {
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return new Date(`${date}T00:00:00.000Z`);
  }

  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

export function dayEnd(date: Date): Date {
  return new Date(date.getTime() + 86_400_000 - 1);
}
