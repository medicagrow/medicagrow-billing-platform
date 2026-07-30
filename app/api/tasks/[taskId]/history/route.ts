import { NextResponse, type NextRequest } from "next/server";
import { TaskStatus } from "@/lib/generated/prisma/enums";
import { apiErrorResponse, requireAuth } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canEditTask } from "@/lib/task-access";

/**
 * GET /api/tasks/[taskId]/history — completions across a recurring series.
 *
 * Works from either end: pass a parent or any of its instances and the whole
 * series comes back, so the panel does not need to know which it is holding.
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
      isRecurring: true,
      parentTaskId: true,
      dueDate: true,
    },
  });

  if (!task || !canEditTask(session!.user, task)) {
    return apiErrorResponse("Task not found.", 404);
  }

  const seriesId = task.parentTaskId ?? task.id;

  const instances = await prisma.task.findMany({
    where: { parentTaskId: seriesId },
    orderBy: [{ instanceNumber: "desc" }],
    take: 200,
    select: {
      id: true,
      instanceNumber: true,
      dueDate: true,
      status: true,
      completedAt: true,
      actualMinutes: true,
      completedBy: { select: { name: true } },
      notes: {
        orderBy: { addedAt: "desc" },
        take: 1,
        select: { note: true },
      },
    },
  });

  const completed = instances.filter(
    (instance) => instance.status === TaskStatus.CLOSED && instance.completedAt,
  );

  const timed = completed.filter((instance) => instance.actualMinutes !== null);

  const averageActualMinutes =
    timed.length === 0
      ? null
      : Math.round(
          timed.reduce(
            (total, instance) => total + (instance.actualMinutes ?? 0),
            0,
          ) / timed.length,
        );

  // "On time" compares the completion against the day it was due. An instance
  // with no due date cannot be late, so it counts as on time.
  const onTime = completed.filter(
    (instance) =>
      !instance.dueDate ||
      instance.completedAt!.getTime() <=
        instance.dueDate.getTime() + 86_399_999,
  ).length;

  return NextResponse.json({
    seriesId,
    rows: instances.map((instance) => ({
      id: instance.id,
      instanceNumber: instance.instanceNumber,
      dueDate: instance.dueDate?.toISOString() ?? null,
      status: instance.status,
      completedAt: instance.completedAt?.toISOString() ?? null,
      completedByName: instance.completedBy?.name ?? null,
      actualMinutes: instance.actualMinutes,
      lastNote: instance.notes[0]?.note ?? null,
    })),
    summary: {
      totalInstances: instances.length,
      totalCompletions: completed.length,
      averageActualMinutes,
      onTimeRate:
        completed.length === 0
          ? null
          : Math.round((onTime / completed.length) * 100),
    },
  });
}
