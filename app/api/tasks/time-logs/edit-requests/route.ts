import { NextResponse } from "next/server";
import { TimeEditRequestStatus } from "@/lib/generated/prisma/enums";
import { requireRole } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getTaskLabel } from "@/lib/task/task-label";

/**
 * GET /api/tasks/time-logs/edit-requests — the review queue.
 *
 * PM/Owner only: a biller reviewing their own correction would defeat the
 * approval step entirely.
 */
export async function GET() {
  const session = await getSession();

  const denied = requireRole(session, ["OWNER", "PROJECT_MANAGER"]);
  if (denied) return denied;

  const requests = await prisma.taskTimeEditRequest.findMany({
    where: { status: TimeEditRequestStatus.PENDING },
    orderBy: { createdAt: "asc" },
    include: {
      requestedBy: { select: { id: true, name: true } },
      timeLog: {
        select: {
          id: true,
          startedAt: true,
          stoppedAt: true,
          durationMinutes: true,
          task: {
            select: {
              id: true,
              title: true,
              taskType: { select: { name: true } },
              practice: { select: { name: true } },
            },
          },
        },
      },
    },
  });

  return NextResponse.json({
    data: requests.map((request) => ({
      id: request.id,
      reason: request.reason,
      createdAt: request.createdAt.toISOString(),
      requestedById: request.requestedById,
      requestedByName: request.requestedBy.name,
      taskId: request.timeLog.task.id,
      taskLabel: getTaskLabel(request.timeLog.task),
      original: {
        logId: request.timeLog.id,
        startedAt: request.timeLog.startedAt.toISOString(),
        stoppedAt: request.timeLog.stoppedAt?.toISOString() ?? null,
        durationMinutes: request.timeLog.durationMinutes,
      },
      requested: {
        startedAt: request.requestedNewStartedAt.toISOString(),
        stoppedAt: request.requestedNewStoppedAt.toISOString(),
        durationMinutes: request.requestedNewDurationMinutes,
      },
    })),
  });
}
