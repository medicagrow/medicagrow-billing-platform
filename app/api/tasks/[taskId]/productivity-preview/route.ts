import { NextResponse, type NextRequest } from "next/server";
import { apiErrorResponse, requireAuth } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canEditTask, canManageTaskTime } from "@/lib/task-access";
import { autoLinkProductivity } from "@/lib/task/productivity-auto-link";

/**
 * GET /api/tasks/[taskId]/productivity-preview
 *
 * What the count *would* be if the task were closed now.
 *
 * The same function the close runs, called ahead of it, so the number on the
 * confirmation screen is the number that gets saved rather than a second
 * estimate of it. It writes nothing.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { taskId: string } },
) {
  const session = await getSession();

  const denied = requireAuth(session);
  if (denied) return denied;

  const task = await prisma.task.findUnique({
    where: { id: params.taskId },
    select: {
      id: true,
      assignedToId: true,
      createdById: true,
      practiceId: true,
      practice: { select: { name: true } },
    },
  });

  if (!task) {
    return apiErrorResponse("Task not found.", 404);
  }

  const allowed =
    canEditTask(session!.user, task) ||
    (await canManageTaskTime(session!.user, task));

  if (!allowed) {
    return apiErrorResponse("Task not found.", 404);
  }

  // Attributed to the assignee, since closing records their work rather than
  // the work of whoever pressed the button.
  const linked = await autoLinkProductivity(task.id, task.assignedToId);

  return NextResponse.json({
    count: linked.count,
    amount: linked.amount?.toString() ?? null,
    source: linked.source,
    from: linked.from?.toISOString() ?? null,
    to: linked.to?.toISOString() ?? null,
    sessionCount: linked.sessionCount,
    practiceName: task.practice?.name ?? null,
  });
}
