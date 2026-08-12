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
import { generateDueInstancesIfNeeded } from "@/lib/task/recurrence";
import { checkHoldReleasesIfNeeded } from "@/lib/todo/hold-release";
import { dayEnd, dayStart } from "@/lib/todo/access";

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

  // Anything whose hold expired must be back in the list before it is read,
  // and any recurring occurrence that came due must exist by now.
  await Promise.all([
    checkHoldReleasesIfNeeded(session!.user.id),
    generateDueInstancesIfNeeded({ assignedToId: session!.user.id }),
  ]);

  const searchParams = request.nextUrl.searchParams;
  const pagination = parsePagination(searchParams);

  const dueDateFrom = searchParams.get("dueDateFrom") ?? undefined;
  const dueDateTo = searchParams.get("dueDateTo") ?? undefined;
  const overdue = searchParams.get("overdue") === "true";
  const dueToday = searchParams.get("dueToday") === "true";

  /**
   * The queue is outstanding work by default, but a biller has a legitimate
   * reason to look at what they finished — checking a timer, or answering
   * "did I do that one". Asking for a status returns it; asking for nothing
   * still returns only what is still on their plate.
   */
  const requestedStatus = searchParams.get("status");
  const status =
    requestedStatus && requestedStatus in TaskStatus
      ? (requestedStatus as TaskStatus)
      : undefined;

  const today = dayStart();

  const range =
    dueDateFrom || dueDateTo
      ? {
          ...(dueDateFrom ? { gte: dayStart(dueDateFrom) } : {}),
          ...(dueDateTo ? { lte: dayEnd(dayStart(dueDateTo)) } : {}),
        }
      : undefined;

  /**
   * Overdue is strictly before today; "today" is everything due by the end of
   * it. They answer different questions, so the UI treats them as mutually
   * exclusive and the last one set here wins.
   */
  const quickRange = overdue
    ? { lt: today }
    : dueToday
      ? { lte: dayEnd(today) }
      : undefined;

  // Both quick filters only narrow the due date.
  const dueDate = quickRange ?? range;

  const where = {
    assignedToId: session!.user.id,
    status: status
      ? { equals: status }
      : { in: [TaskStatus.OPEN, TaskStatus.IN_PROCESS, TaskStatus.HOLD] },
    // A recurring parent is a schedule, not work — its instances are what
    // land on someone's plate.
    isRecurring: false,
    ...(dueDate ? { dueDate } : {}),
  };

  const [tasks, total] = await Promise.all([
    prisma.task.findMany({
      where,
      orderBy:
        status === TaskStatus.CLOSED
          ? // Finished work reads as a log — most recently closed first. Due
            // date is the wrong axis once the thing is done.
            [{ completedAt: { sort: "desc", nulls: "last" } }]
          : [
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
