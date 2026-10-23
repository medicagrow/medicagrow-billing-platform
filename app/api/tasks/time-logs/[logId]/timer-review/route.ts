import { NextResponse, type NextRequest } from "next/server";
import { Role, TimerReviewStatus } from "@/lib/generated/prisma/enums";
import {
  apiErrorResponse,
  requireAuth,
  requireRole,
  zodErrorResponse,
} from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { canManageTaskTime } from "@/lib/task-access";
import {
  findOverlappingLog,
  minutesBetween,
  recalculateTotalLoggedMinutes,
} from "@/lib/task/timer";
import { formatTimeIST } from "@/lib/timezone";
import {
  billerTimerNoteSchema,
  timerReviewSchema,
} from "@/lib/validations/task-timer";

/**
 * PATCH /api/tasks/time-logs/[logId]/timer-review — approve an auto-stopped
 * session, with or without correcting its end time (01 P1-01).
 *
 * Until this runs, the session's hours are counted nowhere. Approving is
 * therefore the act that puts hours into productivity, the planner and pace —
 * which is why it is PM/Owner only, scoped to their practices, and recorded.
 *
 * The end time may be moved anywhere between the start and where the sweep
 * put it. Later than the sweep is not a correction, it is new time the timer
 * never ran for; earlier is the normal case, since the sweep's ceiling is a
 * cap rather than an observation.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { logId: string } },
) {
  const session = await getSession();

  const denied = requireRole(session, [Role.OWNER, Role.PROJECT_MANAGER]);
  if (denied) return denied;

  const body = timerReviewSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!body.success) return zodErrorResponse(body.error);

  const log = await prisma.taskTimeLog.findUnique({
    where: { id: params.logId },
    select: {
      id: true,
      userId: true,
      taskId: true,
      startedAt: true,
      stoppedAt: true,
      durationMinutes: true,
      autoStopped: true,
      autoStoppedAt: true,
      reviewStatus: true,
      task: { select: { practiceId: true, assignedToId: true } },
    },
  });

  if (!log) return apiErrorResponse("Time log not found.", 404);

  if (!(await canManageTaskTime(session!.user, log.task))) {
    return apiErrorResponse("Time log not found.", 404);
  }

  if (log.reviewStatus !== TimerReviewStatus.PENDING) {
    return apiErrorResponse(
      "That session has already been reviewed.",
      409,
    );
  }

  const { newStoppedAt, note } = body.data;
  const now = new Date();

  /** The ceiling: where the sweep stopped it. */
  const autoStopCeiling = log.stoppedAt ?? log.autoStoppedAt ?? now;
  const nextStoppedAt = newStoppedAt ?? autoStopCeiling;

  if (nextStoppedAt <= log.startedAt) {
    return apiErrorResponse(
      `The end time must be after ${formatTimeIST(log.startedAt)}, when the timer started.`,
      400,
    );
  }

  if (nextStoppedAt > autoStopCeiling) {
    return apiErrorResponse(
      `The end time cannot be after ${formatTimeIST(autoStopCeiling)}, when the timer was stopped automatically.`,
      400,
    );
  }

  // A corrected range still must not land on top of another of their sessions.
  const clash = await findOverlappingLog(
    log.userId,
    log.startedAt,
    nextStoppedAt,
    log.id,
  );

  if (clash) {
    return apiErrorResponse(
      `That range overlaps another session of theirs, ${formatTimeIST(
        clash.startedAt,
      )}–${clash.stoppedAt ? formatTimeIST(clash.stoppedAt) : "running"}.`,
      409,
    );
  }

  const newDuration = minutesBetween(log.startedAt, nextStoppedAt);
  const changed = nextStoppedAt.getTime() !== autoStopCeiling.getTime();

  const updated = await prisma.$transaction(async (tx) => {
    /**
     * The adjustment row is written whenever the reviewer moved the end time,
     * add-only, so a session corrected twice keeps both steps. Approving as-is
     * writes no adjustment — there was no change to record beyond the
     * approval itself, which the log carries.
     */
    if (changed) {
      await tx.taskTimeLogAdjustment.create({
        data: {
          logId: log.id,
          oldStoppedAt: log.stoppedAt,
          newStoppedAt: nextStoppedAt,
          oldDurationMinutes: log.durationMinutes,
          newDurationMinutes: newDuration,
          note: note ?? null,
          changedById: session!.user.id,
        },
      });
    }

    const row = await tx.taskTimeLog.update({
      where: { id: log.id },
      data: {
        stoppedAt: nextStoppedAt,
        durationMinutes: newDuration,
        reviewStatus: TimerReviewStatus.APPROVED,
        reviewedById: session!.user.id,
        reviewedAt: now,
        ...(changed
          ? {
              isEdited: true,
              editNote: note ?? null,
              // Preserved once, so the first figure stays visible.
              originalDurationMinutes:
                log.durationMinutes ?? null,
            }
          : {}),
      },
      select: { id: true, taskId: true, durationMinutes: true },
    });

    return row;
  });

  // Now that it counts, the task's total has to include it.
  const totalLoggedMinutes = await recalculateTotalLoggedMinutes(log.taskId);

  return NextResponse.json({
    logId: updated.id,
    durationMinutes: updated.durationMinutes,
    adjusted: changed,
    totalLoggedMinutes,
  });
}

/**
 * POST /api/tasks/time-logs/[logId]/timer-review — the biller's account of
 * when they actually stopped.
 *
 * They may write it and rewrite it; they may not approve it. The note is what
 * the reviewer reads, so the person who was there gets to put it on the
 * record without also signing it off.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { logId: string } },
) {
  const session = await getSession();

  const denied = requireAuth(session);
  if (denied) return denied;

  const body = billerTimerNoteSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!body.success) return zodErrorResponse(body.error);

  const log = await prisma.taskTimeLog.findUnique({
    where: { id: params.logId },
    select: {
      id: true,
      userId: true,
      reviewStatus: true,
      task: { select: { practiceId: true, assignedToId: true } },
    },
  });

  if (!log) return apiErrorResponse("Time log not found.", 404);

  const isOwnSession = log.userId === session!.user.id;
  const isManager = await canManageTaskTime(session!.user, log.task);

  if (!isOwnSession && !isManager) {
    return apiErrorResponse("Time log not found.", 404);
  }

  if (log.reviewStatus !== TimerReviewStatus.PENDING) {
    return apiErrorResponse(
      "That session has already been reviewed.",
      409,
    );
  }

  await prisma.taskTimeLog.update({
    where: { id: log.id },
    data: { billerNote: body.data.billerNote },
  });

  return NextResponse.json({ logId: log.id });
}
