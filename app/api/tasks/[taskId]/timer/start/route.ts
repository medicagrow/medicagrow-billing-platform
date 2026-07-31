import { NextResponse, type NextRequest } from "next/server";
import { apiErrorResponse, requireAuth } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canEditTask } from "@/lib/task-access";
import { TASK_INCLUDE, toTaskDto } from "@/lib/task-serialize";
import { stopActiveTimerFor } from "@/lib/task/timer";

/**
 * POST /api/tasks/[taskId]/timer/start
 *
 * Starting a timer stops whatever else the caller had running. One clock per
 * person: two running at once would double-count the same minutes.
 */
export async function POST(
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
      status: true,
      activeTimerUserId: true,
      activeTimerStartedAt: true,
    },
  });

  if (!task || !canEditTask(session!.user, task)) {
    return apiErrorResponse("Task not found.", 404);
  }

  if (task.activeTimerUserId && task.activeTimerUserId !== session!.user.id) {
    return apiErrorResponse(
      "Someone else already has a timer running on this task.",
      409,
    );
  }

  if (task.activeTimerUserId === session!.user.id) {
    return apiErrorResponse("Your timer is already running on this task.", 409);
  }

  const stopped = await stopActiveTimerFor(session!.user.id);

  const updated = await prisma.task.update({
    where: { id: params.taskId },
    data: {
      activeTimerStartedAt: new Date(),
      activeTimerUserId: session!.user.id,
    },
    include: TASK_INCLUDE,
  });

  return NextResponse.json({
    task: toTaskDto(updated),
    // Surfaced so the UI can say what it interrupted rather than leaving the
    // biller to notice their other timer vanished.
    stoppedPreviousTimer: stopped,
  });
}
