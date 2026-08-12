import { NextResponse, type NextRequest } from "next/server";
import { Role, TaskStatus } from "@/lib/generated/prisma/enums";
import { apiErrorResponse, requireRole } from "@/lib/api-helpers";
import {
  accessiblePracticeIds,
  canAccessBatch,
  practiceAssignees,
} from "@/lib/ar-access";
import { claimRatesFor } from "@/lib/analytics/claim-avg";
import { getWorkloadData } from "@/lib/analytics/workload";
import {
  DAILY_HOURS_TASK_TYPE,
  dailyHoursOf,
  spreadDays,
  workingDaysBetween,
} from "@/lib/task/daily-hours";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { dayStart } from "@/lib/todo/access";

/** A working day, for the free-hours arithmetic. */
const HOURS_PER_DAY = 8;

const round = (hours: number) => Math.round(hours * 10) / 10;

/**
 * GET /api/ar/batches/[batchId]/biller-capacity
 *
 * "Who has room for this batch, and how much?" — answered before the claims
 * are handed out rather than discovered a fortnight later.
 *
 * The subtraction that matters is the second one. A biller's free hours are
 * not just their working days minus their own tasks: they are also already
 * committed to other practices' AR, often on another PM's say-so. Leaving that
 * out is how somebody ends up with three practices' books and no way to say
 * they are full, so AR commitments are counted **across every practice** and
 * broken down by name, with the PM who owns each one.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { batchId: string } },
) {
  const session = await getSession();

  const denied = requireRole(session, [Role.OWNER, Role.PROJECT_MANAGER]);
  if (denied) return denied;

  if (!(await canAccessBatch(session!.user, params.batchId))) {
    return apiErrorResponse("Batch not found.", 404);
  }

  const batch = await prisma.arBatch.findUnique({
    where: { id: params.batchId },
    select: {
      practiceId: true,
      uploadedAt: true,
      targetCompletionDate: true,
    },
  });

  if (!batch) return apiErrorResponse("Batch not found.", 404);

  const search = request.nextUrl.searchParams;

  /**
   * The window defaults to the batch's own life: from when it was uploaded to
   * its target date, or the end of this month when it has none. That is the
   * period the PM is actually planning, so it is the period the hours should
   * be counted over.
   */
  const today = dayStart();

  const parseDay = (value: string | null) =>
    value && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? new Date(`${value}T00:00:00.000Z`)
      : null;

  const uploadedDay = dayStart(batch.uploadedAt.toISOString().slice(0, 10));

  const from = parseDay(search.get("from")) ?? (uploadedDay > today ? uploadedDay : today);

  const endOfMonth = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 0),
  );

  const to =
    parseDay(search.get("to")) ??
    (batch.targetCompletionDate
      ? dayStart(batch.targetCompletionDate.toISOString().slice(0, 10))
      : endOfMonth);

  if (from > to) {
    return apiErrorResponse("That date range ends before it starts.", 400);
  }

  // Only people this batch can actually be assigned to.
  const assignees = await practiceAssignees(batch.practiceId);
  const userIds = assignees.map((user) => user.id);

  if (userIds.length === 0) {
    return NextResponse.json({ from: iso(from), to: iso(to), billers: [] });
  }

  const [workload, arTasks, rates] = await Promise.all([
    /**
     * The planner already knows how to place non-AR work day by day, so the
     * free-hours figure is taken from it rather than recomputed — two answers
     * to "how booked is this person" would eventually disagree.
     */
    getWorkloadData({
      from,
      to,
      userIds,
      targetHoursPerDay: HOURS_PER_DAY,
      viewerPracticeIds: await accessiblePracticeIds(session!.user),
    }),
    /** Every practice's AR, not just this one — see the note above. */
    prisma.task.findMany({
      where: {
        taskType: {
          is: {
            name: {
              equals: DAILY_HOURS_TASK_TYPE,
              mode: "insensitive" as const,
            },
          },
        },
        isRecurring: false,
        status: { not: TaskStatus.CLOSED },
        assignedToId: { in: userIds },
        dueDate: { gte: from },
        OR: [
          { startDate: { lte: to } },
          { startDate: null, createdAt: { lte: to } },
        ],
      },
      select: {
        id: true,
        assignedToId: true,
        startDate: true,
        dueDate: true,
        dailyHours: true,
        createdAt: true,
        practiceId: true,
        practice: {
          select: { id: true, name: true, primaryPm: { select: { name: true } } },
        },
      },
    }),
    claimRatesFor(userIds, batch.practiceId),
  ]);

  const workingDays = workingDaysBetween(from, to);
  const capacityHours = workingDays * HOURS_PER_DAY;

  /** userId → practiceId → commitment. */
  const commitments = new Map<
    string,
    Map<
      string,
      {
        practiceId: string;
        practiceName: string;
        pmName: string | null;
        dailyHours: number;
        totalHours: number;
      }
    >
  >();

  const unconfigured = new Map<string, number>();

  for (const task of arTasks) {
    const hours = dailyHoursOf(task);

    if (hours === null) {
      unconfigured.set(
        task.assignedToId,
        (unconfigured.get(task.assignedToId) ?? 0) + 1,
      );
      continue;
    }

    // Only the days that fall inside the window count — a project ending on
    // the 10th does not consume the rest of the month.
    const days = spreadDays(task, from, to).length;
    if (days === 0) continue;

    const byPractice =
      commitments.get(task.assignedToId) ??
      new Map<
        string,
        {
          practiceId: string;
          practiceName: string;
          pmName: string | null;
          dailyHours: number;
          totalHours: number;
        }
      >();

    const key = task.practiceId ?? "none";
    const existing = byPractice.get(key);

    if (existing) {
      // Two projects for one practice in the same window read as one line.
      existing.dailyHours += hours;
      existing.totalHours += hours * days;
    } else {
      byPractice.set(key, {
        practiceId: task.practiceId ?? "",
        practiceName: task.practice?.name ?? "No practice",
        pmName: task.practice?.primaryPm?.name ?? null,
        dailyHours: hours,
        totalHours: hours * days,
      });
    }

    commitments.set(task.assignedToId, byPractice);
  }

  const billers = assignees.map((user) => {
    const row = workload.billers.find((entry) => entry.userId === user.id);

    /**
     * Non-AR load only: the AR half is subtracted separately and shown broken
     * down, so counting it here as well would take it off twice.
     */
    const nonArMinutes =
      row?.days.reduce(
        (sum, day) =>
          sum + (day.isWeekend ? 0 : day.totalMinutes - day.arMinutes),
        0,
      ) ?? 0;

    const freeHours = Math.max(0, capacityHours - nonArMinutes / 60);

    const arCommitted = Array.from(
      commitments.get(user.id)?.values() ?? [],
    ).sort((a, b) => b.totalHours - a.totalHours);

    const committedHours = arCommitted.reduce(
      (sum, entry) => sum + entry.totalHours,
      0,
    );

    const netAvailableHours = Math.max(0, freeHours - committedHours);

    const rate = rates.get(user.id);
    const minutesPerClaim = rate?.minutesPerClaim ?? null;

    return {
      userId: user.id,
      userName: user.name,
      role: user.role,
      freeHours: round(freeHours),
      arCommitted: arCommitted.map((entry) => ({
        ...entry,
        dailyHours: round(entry.dailyHours),
        totalHours: round(entry.totalHours),
      })),
      netAvailableHours: round(netAvailableHours),
      avgMinutesPerClaim: minutesPerClaim,
      /** Null when nobody has enough closed AR history to derive a rate. */
      estimatedClaimsCapacity:
        minutesPerClaim && minutesPerClaim > 0
          ? Math.floor((netAvailableHours * 60) / minutesPerClaim)
          : null,
      isTeamRate: rate?.isTeamFallback ?? true,
      /** Their AR commitment is understated by this many unplaceable tasks. */
      unconfiguredArTasks: unconfigured.get(user.id) ?? 0,
    };
  });

  return NextResponse.json({
    from: iso(from),
    to: iso(to),
    workingDays,
    hoursPerDay: HOURS_PER_DAY,
    billers,
  });
}

const iso = (date: Date) => date.toISOString().slice(0, 10);
