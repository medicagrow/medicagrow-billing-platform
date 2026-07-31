import { NextResponse, type NextRequest } from "next/server";
import { apiErrorResponse, requireAuth } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { TASK_INCLUDE, toTaskDto } from "@/lib/task-serialize";
import {
  minutesBetween,
  recalculateTotalLoggedMinutes,
} from "@/lib/task/timer";
import { toTaskTimeLogDto } from "@/lib/task-timer-serialize";

/**
 * POST /api/tasks/[taskId]/timer/stop
 *
 * Only the person whose timer is running may stop it — a PM stopping someone
 * else's clock would write a log against their name that they did not start.
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
      activeTimerUserId: true,
      activeTimerStartedAt: true,
    },
  });

  if (!task) {
    return apiErrorResponse("Task not found.", 404);
  }

  if (!task.activeTimerStartedAt || !task.activeTimerUserId) {
    return apiErrorResponse("No timer is running on this task.", 409);
  }

  if (task.activeTimerUserId !== session!.user.id) {
    return apiErrorResponse(
      "Only the person who started this timer can stop it.",
      403,
    );
  }

  const stoppedAt = new Date();
  const startedAt = task.activeTimerStartedAt;

  const log = await prisma.taskTimeLog.create({
    data: {
      taskId: task.id,
      userId: session!.user.id,
      startedAt,
      stoppedAt,
      durationMinutes: minutesBetween(startedAt, stoppedAt),
    },
    include: {
      user: { select: { name: true } },
      editApprovedBy: { select: { name: true } },
      editRequests: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, status: true },
      },
    },
  });

  await prisma.task.update({
    where: { id: task.id },
    data: { activeTimerStartedAt: null, activeTimerUserId: null },
  });

  const totalLoggedMinutes = await recalculateTotalLoggedMinutes(task.id);

  const updated = await prisma.task.findUnique({
    where: { id: task.id },
    include: TASK_INCLUDE,
  });

  return NextResponse.json({
    timeLog: toTaskTimeLogDto(log),
    totalLoggedMinutes,
    task: updated ? toTaskDto(updated) : null,
  });
}
