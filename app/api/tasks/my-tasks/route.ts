import { type NextRequest } from "next/server";
import { TaskStatus, TodoPriority } from "@/lib/generated/prisma/enums";
import {
  paginatedResponse,
  parsePagination,
  requireAuth,
} from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { TASK_INCLUDE, toTaskDto } from "@/lib/task-serialize";
import { checkHoldReleases } from "@/lib/todo/hold-release";

/**
 * GET /api/tasks/my-tasks — everything still on the caller's plate.
 *
 * Ordering is URGENT first, then by due date, then by priority: an urgent task
 * jumps the queue regardless of when it is due, which is the point of the flag.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();

  const denied = requireAuth(session);
  if (denied) return denied;

  // Anything whose hold expired must be back in the list before it is read.
  await checkHoldReleases(session!.user.id);

  const pagination = parsePagination(request.nextUrl.searchParams);

  const where = {
    assignedToId: session!.user.id,
    status: { in: [TaskStatus.OPEN, TaskStatus.IN_PROCESS, TaskStatus.HOLD] },
    // A recurring parent is a schedule, not work — its instances are what
    // land on someone's plate.
    isRecurring: false,
  };

  const [tasks, total] = await Promise.all([
    prisma.task.findMany({
      where,
      orderBy: [
        { dueDate: { sort: "asc", nulls: "last" } },
        { priority: "asc" },
        { createdAt: "asc" },
      ],
      skip: pagination.skip,
      take: pagination.take,
      include: TASK_INCLUDE,
    }),
    prisma.task.count({ where }),
  ]);

  // Urgent floats to the top of the page. Sorting in the database would need
  // a CASE expression Prisma cannot express; the page is bounded, so this
  // reorders rows already fetched rather than filtering them.
  const ordered = [...tasks].sort((a, b) => {
    const aUrgent = a.priority === TodoPriority.URGENT ? 0 : 1;
    const bUrgent = b.priority === TodoPriority.URGENT ? 0 : 1;
    return aUrgent - bUrgent;
  });

  return paginatedResponse(ordered.map(toTaskDto), total, pagination);
}
