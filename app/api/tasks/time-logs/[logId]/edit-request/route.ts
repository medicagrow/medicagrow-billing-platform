import { NextResponse, type NextRequest } from "next/server";
import { TimeEditRequestStatus } from "@/lib/generated/prisma/enums";
import {
  apiErrorResponse,
  requireAuth,
  zodErrorResponse,
} from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import {
  EDIT_WINDOW_HOURS,
  isWithinEditWindow,
  minutesBetween,
} from "@/lib/task/timer";
import { createTimeEditRequestSchema } from "@/lib/validations/task-timer";

/**
 * POST /api/tasks/time-logs/[logId]/edit-request
 *
 * A biller asks for a correction; a PM or Owner decides. Nobody edits their
 * own logged time directly, which is the point of the whole flow.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { logId: string } },
) {
  const session = await getSession();

  const denied = requireAuth(session);
  if (denied) return denied;

  const body = createTimeEditRequestSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!body.success) {
    return zodErrorResponse(body.error);
  }

  const log = await prisma.taskTimeLog.findUnique({
    where: { id: params.logId },
    select: { id: true, userId: true, startedAt: true, stoppedAt: true },
  });

  if (!log) {
    return apiErrorResponse("Time log not found.", 404);
  }

  // Only the person who logged the time may ask for it to be changed.
  if (log.userId !== session!.user.id) {
    return apiErrorResponse(
      "You can only request edits to your own time logs.",
      403,
    );
  }

  if (!log.stoppedAt) {
    return apiErrorResponse(
      "That timer is still running — stop it before requesting an edit.",
      409,
    );
  }

  if (!isWithinEditWindow(log.startedAt)) {
    return apiErrorResponse(
      `Time logs can only be corrected within ${EDIT_WINDOW_HOURS} hours of starting.`,
      422,
    );
  }

  // A second pending request would give the reviewer two answers to one
  // question.
  const alreadyPending = await prisma.taskTimeEditRequest.findFirst({
    where: { timeLogId: log.id, status: TimeEditRequestStatus.PENDING },
    select: { id: true },
  });

  if (alreadyPending) {
    return apiErrorResponse(
      "There is already a pending edit request for this time log.",
      409,
    );
  }

  const { startedAt, stoppedAt, reason } = body.data;

  const created = await prisma.taskTimeEditRequest.create({
    data: {
      timeLogId: log.id,
      requestedById: session!.user.id,
      requestedNewStartedAt: startedAt,
      requestedNewStoppedAt: stoppedAt,
      requestedNewDurationMinutes: minutesBetween(startedAt, stoppedAt),
      reason,
    },
  });

  await prisma.taskTimeLog.update({
    where: { id: log.id },
    data: { editRequestedAt: new Date() },
  });

  return NextResponse.json({ request: created }, { status: 201 });
}
