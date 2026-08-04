import { NextResponse, type NextRequest } from "next/server";
import { TimeEditRequestStatus } from "@/lib/generated/prisma/enums";
import {
  apiErrorResponse,
  requireRole,
  zodErrorResponse,
} from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { getTaskLabel } from "@/lib/task/task-label";
import {
  findOverlappingLog,
  minutesBetween,
  recalculateTotalLoggedMinutes,
} from "@/lib/task/timer";
import { formatTimeIST } from "@/lib/timezone";
import { reviewTimeEditRequestSchema } from "@/lib/validations/task-timer";

/** "9:15 AM" — how a reviewer reads a time, not an ISO string. */
function clockTime(value: Date): string {
  return formatTimeIST(value);
}

/**
 * PATCH /api/tasks/time-logs/edit-requests/[requestId] — approve or reject.
 *
 * Approval rewrites the log's times and keeps the duration it replaced, so a
 * correction is visible afterwards rather than indistinguishable from time
 * that was logged that way to begin with.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { requestId: string } },
) {
  const session = await getSession();

  const denied = requireRole(session, ["OWNER", "PROJECT_MANAGER"]);
  if (denied) return denied;

  const body = reviewTimeEditRequestSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!body.success) {
    return zodErrorResponse(body.error);
  }

  const editRequest = await prisma.taskTimeEditRequest.findUnique({
    where: { id: params.requestId },
    include: {
      timeLog: {
        select: {
          id: true,
          taskId: true,
          userId: true,
          durationMinutes: true,
          originalDurationMinutes: true,
        },
      },
    },
  });

  if (!editRequest) {
    return apiErrorResponse("Edit request not found.", 404);
  }

  if (editRequest.status !== TimeEditRequestStatus.PENDING) {
    return apiErrorResponse(
      `That request has already been ${editRequest.status.toLowerCase()}.`,
      409,
    );
  }

  const { status, reviewNote } = body.data;
  const now = new Date();

  if (status === TimeEditRequestStatus.REJECTED) {
    const updated = await prisma.taskTimeEditRequest.update({
      where: { id: editRequest.id },
      data: {
        status,
        reviewedById: session!.user.id,
        reviewedAt: now,
        reviewNote: reviewNote ?? null,
      },
    });

    return NextResponse.json({ request: updated });
  }

  // Approving: nobody can be in two places at once, so the corrected range
  // must not land on top of another log of theirs.
  const clash = await findOverlappingLog(
    editRequest.timeLog.userId,
    editRequest.requestedNewStartedAt,
    editRequest.requestedNewStoppedAt,
    editRequest.timeLog.id,
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
        error: `This time range overlaps with ${label} logged from ${clockTime(
          clash.startedAt,
        )} to ${clash.stoppedAt ? clockTime(clash.stoppedAt) : "an open timer"}`,
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

  const newDuration = minutesBetween(
    editRequest.requestedNewStartedAt,
    editRequest.requestedNewStoppedAt,
  );

  const [updatedRequest] = await prisma.$transaction([
    prisma.taskTimeEditRequest.update({
      where: { id: editRequest.id },
      data: {
        status,
        reviewedById: session!.user.id,
        reviewedAt: now,
        reviewNote: reviewNote ?? null,
      },
    }),
    prisma.taskTimeLog.update({
      where: { id: editRequest.timeLog.id },
      data: {
        startedAt: editRequest.requestedNewStartedAt,
        stoppedAt: editRequest.requestedNewStoppedAt,
        durationMinutes: newDuration,
        isEdited: true,
        editApprovedAt: now,
        editApprovedById: session!.user.id,
        editNote: editRequest.reason,
        // Preserved once. A second approved edit must not overwrite what the
        // timer originally recorded with what the first correction produced.
        ...(editRequest.timeLog.originalDurationMinutes === null &&
        editRequest.timeLog.durationMinutes !== null
          ? { originalDurationMinutes: editRequest.timeLog.durationMinutes }
          : {}),
      },
    }),
  ]);

  const totalLoggedMinutes = await recalculateTotalLoggedMinutes(
    editRequest.timeLog.taskId,
  );

  return NextResponse.json({
    request: updatedRequest,
    totalLoggedMinutes,
  });
}
