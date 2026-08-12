// ADD-ONLY: this is a read of the edit trail. Corrections are made through
// the direct-edit route or the approval flow, never here.
import { NextResponse } from "next/server";
import { Role } from "@/lib/generated/prisma/enums";
import { requireRole } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { practiceMembershipIds } from "@/lib/task-access";
import { getTaskLabel } from "@/lib/task/task-label";

/** A month of history is enough to answer "who changed this, and why". */
const WINDOW_DAYS = 30;

/**
 * GET /api/tasks/time-logs/direct-edits — corrections a manager applied
 * without an approval step.
 *
 * The approval queue shows what is waiting on somebody. This shows what has
 * already happened without anyone else in the loop, which is the part that
 * needs to be visible: a direct edit has no second signature, so the record of
 * it is the only check on it.
 */
export async function GET() {
  const session = await getSession();

  const denied = requireRole(session, [Role.OWNER, Role.PROJECT_MANAGER]);
  if (denied) return denied;

  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000);

  /**
   * A PM sees their own practices' edits; an Owner sees all of them. A general
   * task carries no practice, so it is placed by who holds it — the same rule
   * `taskVisibilityFilter` uses.
   */
  let practiceScope = {};

  if (session!.user.role !== Role.OWNER) {
    const practiceIds = await practiceMembershipIds(session!.user.id);

    practiceScope = {
      task: {
        OR: [
          { practiceId: { in: practiceIds } },
          {
            practiceId: null,
            assignedTo: {
              practices: { some: { practiceId: { in: practiceIds } } },
            },
          },
        ],
      },
    };
  }

  const logs = await prisma.taskTimeLog.findMany({
    where: {
      isEdited: true,
      editApprovedAt: { gte: since },
      /**
       * A direct edit is an edit with no request behind it. The request flow
       * writes the same approval stamps, so the absence of the request is what
       * distinguishes the two.
       */
      editRequests: { none: {} },
      ...practiceScope,
    },
    orderBy: { editApprovedAt: "desc" },
    take: 100,
    select: {
      id: true,
      startedAt: true,
      stoppedAt: true,
      durationMinutes: true,
      originalDurationMinutes: true,
      editNote: true,
      editApprovedAt: true,
      user: { select: { name: true } },
      editApprovedBy: { select: { name: true } },
      task: {
        select: {
          id: true,
          title: true,
          taskType: { select: { name: true } },
          practice: { select: { name: true } },
        },
      },
    },
  });

  return NextResponse.json({
    data: logs.map((log) => ({
      logId: log.id,
      taskId: log.task.id,
      taskLabel: getTaskLabel(log.task),
      practiceName: log.task.practice?.name ?? null,
      billerName: log.user.name,
      startedAt: log.startedAt.toISOString(),
      stoppedAt: log.stoppedAt?.toISOString() ?? null,
      durationMinutes: log.durationMinutes,
      originalDurationMinutes: log.originalDurationMinutes,
      editNote: log.editNote,
      editedByName: log.editApprovedBy?.name ?? null,
      editedAt: log.editApprovedAt?.toISOString() ?? null,
    })),
  });
}
