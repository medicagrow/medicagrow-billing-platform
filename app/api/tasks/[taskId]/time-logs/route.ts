// ADD-ONLY: time logs are written by the timer and corrected only through an
// approved edit request. Do not add PUT, PATCH or DELETE here.
import { NextResponse, type NextRequest } from "next/server";
import { apiErrorResponse, requireAuth } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canEditTask } from "@/lib/task-access";
import { TIME_LOG_INCLUDE, toTaskTimeLogDto } from "@/lib/task-timer-serialize";

/** GET /api/tasks/[taskId]/time-logs — every session worked on this task. */
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
      totalLoggedMinutes: true,
    },
  });

  if (!task || !canEditTask(session!.user, task)) {
    return apiErrorResponse("Task not found.", 404);
  }

  const logs = await prisma.taskTimeLog.findMany({
    where: { taskId: task.id },
    orderBy: { startedAt: "desc" },
    include: TIME_LOG_INCLUDE,
  });

  return NextResponse.json({
    data: logs.map(toTaskTimeLogDto),
    totalLoggedMinutes: task.totalLoggedMinutes,
  });
}
