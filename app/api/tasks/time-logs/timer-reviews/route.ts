// ADD-ONLY: this reads the review queue. Decisions are made through
// /api/tasks/time-logs/[logId]/timer-review.
import { NextResponse } from "next/server";
import { Role, TimerReviewStatus } from "@/lib/generated/prisma/enums";
import { requireRole } from "@/lib/api-helpers";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { practiceMembershipIds } from "@/lib/task-access";
import { getTaskLabel } from "@/lib/task/task-label";
import { getShiftDay } from "@/lib/shift-day";

/** Enough to clear a backlog in one sitting without an unbounded response. */
const MAX_ITEMS = 200;

/**
 * GET /api/tasks/time-logs/timer-reviews — sessions stopped by the sweep.
 *
 * A PM sees their own practices, the Owner sees everyone — the same scope the
 * direct-edits trail uses, and the scope the edit-request queue was missing
 * entirely. A general task carries no practice, so it is placed by who holds
 * it, exactly as `taskVisibilityFilter` does.
 *
 * Each item carries the biller's other sessions on the same shift day, since
 * "when did you actually stop" is usually answered by what they did next.
 */
export async function GET() {
  const session = await getSession();

  const denied = requireRole(session, [Role.OWNER, Role.PROJECT_MANAGER]);
  if (denied) return denied;

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

  const pending = await prisma.taskTimeLog.findMany({
    where: { reviewStatus: TimerReviewStatus.PENDING, ...practiceScope },
    orderBy: { startedAt: "asc" },
    take: MAX_ITEMS,
    select: {
      id: true,
      startedAt: true,
      stoppedAt: true,
      durationMinutes: true,
      autoStoppedAt: true,
      billerNote: true,
      userId: true,
      user: { select: { id: true, name: true } },
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

  /**
   * The reviewer needs the rest of that person's day, and one query gets it
   * for every item rather than one per row.
   */
  const spans = pending.map((log) => ({
    userId: log.userId,
    from: new Date(
      Date.UTC(
        log.startedAt.getUTCFullYear(),
        log.startedAt.getUTCMonth(),
        log.startedAt.getUTCDate(),
      ),
    ),
  }));

  const sameDay =
    spans.length === 0
      ? []
      : await prisma.taskTimeLog.findMany({
          where: {
            OR: spans.map((span) => ({
              userId: span.userId,
              startedAt: {
                gte: span.from,
                lt: new Date(span.from.getTime() + 86_400_000),
              },
            })),
            stoppedAt: { not: null },
          },
          select: {
            id: true,
            userId: true,
            startedAt: true,
            stoppedAt: true,
            durationMinutes: true,
            reviewStatus: true,
            task: {
              select: {
                title: true,
                taskType: { select: { name: true } },
                practice: { select: { name: true } },
              },
            },
          },
          orderBy: { startedAt: "asc" },
        });

  return NextResponse.json({
    data: pending.map((log) => {
      const shiftDay = getShiftDay(log.userId, log.startedAt);

      return {
        logId: log.id,
        billerId: log.user.id,
        billerName: log.user.name,
        taskId: log.task.id,
        taskLabel: getTaskLabel(log.task),
        practiceName: log.task.practice?.name ?? null,
        shiftDay,
        startedAt: log.startedAt.toISOString(),
        /** Where the sweep put the end — the ceiling for any correction. */
        autoStoppedAt: (log.stoppedAt ?? log.autoStoppedAt)?.toISOString() ?? null,
        durationMinutes: log.durationMinutes,
        billerNote: log.billerNote,
        otherSessions: sameDay
          .filter(
            (other) =>
              other.userId === log.userId &&
              other.id !== log.id &&
              getShiftDay(other.userId, other.startedAt) === shiftDay,
          )
          .map((other) => ({
            logId: other.id,
            label: getTaskLabel(other.task),
            practiceName: other.task.practice?.name ?? null,
            startedAt: other.startedAt.toISOString(),
            stoppedAt: other.stoppedAt?.toISOString() ?? null,
            durationMinutes: other.durationMinutes,
            isPending: other.reviewStatus === TimerReviewStatus.PENDING,
          })),
      };
    }),
  });
}
