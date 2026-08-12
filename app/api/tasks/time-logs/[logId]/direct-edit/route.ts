import { NextResponse, type NextRequest } from "next/server";
import {
  apiErrorResponse,
  requireRole,
  zodErrorResponse,
} from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canManageTaskTime } from "@/lib/task-access";
import { getTaskLabel } from "@/lib/task/task-label";
import {
  findOverlappingLog,
  minutesBetween,
  recalculateTotalLoggedMinutes,
} from "@/lib/task/timer";
import { toTaskTimeLogDto, TIME_LOG_INCLUDE } from "@/lib/task-timer-serialize";
import { formatTimeIST } from "@/lib/timezone";
import { directTimeEditSchema } from "@/lib/validations/task-timer";

/**
 * PATCH /api/tasks/time-logs/[logId]/direct-edit
 *
 * A manager correcting a log outright, with no request and no approval step.
 *
 * The request/approve flow exists so that **nobody edits their own logged
 * time** — that is its whole point, and it stays exactly as it was for
 * billers. A PM correcting somebody else's timer is not that situation: they
 * are the approver, and making them file a request to themselves would be a
 * form with one signature on both lines.
 *
 * Two rules the approval flow has, kept here:
 *
 *  - the **overlap check**, because a person still cannot be in two places at
 *    once, whoever is typing; and
 *  - `originalDurationMinutes` **preserved once**, so a correction stays
 *    visible afterwards rather than becoming indistinguishable from time that
 *    was logged that way to begin with.
 *
 * One rule deliberately dropped: the 48-hour window. That exists to stop a
 * biller quietly reshaping last month's timesheet. A manager correcting an old
 * log is doing the reviewing the window was protecting, and the edit is
 * stamped with their name either way.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { logId: string } },
) {
  const session = await getSession();

  const denied = requireRole(session, ["OWNER", "PROJECT_MANAGER"]);
  if (denied) return denied;

  const body = directTimeEditSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!body.success) {
    return zodErrorResponse(body.error);
  }

  const log = await prisma.taskTimeLog.findUnique({
    where: { id: params.logId },
    select: {
      id: true,
      taskId: true,
      userId: true,
      stoppedAt: true,
      durationMinutes: true,
      originalDurationMinutes: true,
      task: { select: { practiceId: true, assignedToId: true } },
    },
  });

  if (!log) {
    return apiErrorResponse("Time log not found.", 404);
  }

  // An Owner reaches everything; a PM only the practices they manage.
  if (!(await canManageTaskTime(session!.user, log.task))) {
    return apiErrorResponse(
      "That time log belongs to a practice you do not manage.",
      403,
    );
  }

  if (!log.stoppedAt) {
    return apiErrorResponse(
      "That timer is still running — stop it before editing the log.",
      409,
    );
  }

  const { newStartedAt, newStoppedAt, editNote } = body.data;

  const clash = await findOverlappingLog(
    log.userId,
    newStartedAt,
    newStoppedAt,
    log.id,
  );

  if (clash) {
    const clashTask = await prisma.task.findUnique({
      where: { id: clash.taskId },
      select: {
        title: true,
        taskType: { select: { name: true } },
        practice: { select: { name: true } },
      },
    });

    const label = clashTask ? getTaskLabel(clashTask) : "another task";

    return NextResponse.json(
      {
        error: `This time range overlaps with ${label} logged from ${formatTimeIST(
          clash.startedAt,
        )} to ${
          clash.stoppedAt ? formatTimeIST(clash.stoppedAt) : "an open timer"
        }`,
        conflict: {
          taskId: clash.taskId,
          taskLabel: label,
          logId: clash.logId,
          startedAt: clash.startedAt.toISOString(),
          stoppedAt: clash.stoppedAt?.toISOString() ?? null,
        },
      },
      { status: 409 },
    );
  }

  const now = new Date();

  const updated = await prisma.taskTimeLog.update({
    where: { id: log.id },
    data: {
      startedAt: newStartedAt,
      stoppedAt: newStoppedAt,
      durationMinutes: minutesBetween(newStartedAt, newStoppedAt),
      isEdited: true,
      editNote,
      editApprovedAt: now,
      editApprovedById: session!.user.id,
      // Preserved once: a second edit must not overwrite what the timer
      // originally recorded with what the first correction produced.
      ...(log.originalDurationMinutes === null && log.durationMinutes !== null
        ? { originalDurationMinutes: log.durationMinutes }
        : {}),
    },
    include: TIME_LOG_INCLUDE,
  });

  const totalLoggedMinutes = await recalculateTotalLoggedMinutes(log.taskId);

  return NextResponse.json({
    log: toTaskTimeLogDto(updated),
    totalLoggedMinutes,
  });
}
