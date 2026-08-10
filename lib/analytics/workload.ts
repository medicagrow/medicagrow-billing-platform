import { Role, TaskStatus } from "@/lib/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { projectRecurringTasks } from "@/lib/task/workload-projection";
import { isWeekend, toIsoDate } from "@/lib/task/recurrence-config";
import { dayStart } from "@/lib/todo/access";

/**
 * Who is booked, who is free, and on which day.
 *
 * The past and the future are measured differently on purpose. For a day that
 * has happened the honest number is what the timer recorded; for one that has
 * not, it is what has been assigned. Mixing them — estimating yesterday, or
 * reporting zero logged hours for next Tuesday — makes the grid unreadable.
 *
 * Projected recurring work is kept separate from assigned work all the way to
 * the UI, because a projection is a forecast and a plan built on one should
 * say so.
 */

export interface WorkloadDay {
  /** YYYY-MM-DD, UTC. */
  date: string;
  /** Real tasks: logged minutes for a past day, estimated for a future one. */
  actualMinutes: number;
  /** Recurring occurrences that do not exist yet. */
  projectedMinutes: number;
  totalMinutes: number;
  isOverCapacity: boolean;
  isUnderAssigned: boolean;
  /** Weekends carry no target, so they are neither over nor under. */
  isWeekend: boolean;
  /** True once the day is today or later — the projection half applies. */
  isFuture: boolean;
  /** What is on the day, for the cell's tooltip. */
  items: {
    label: string;
    practiceName: string | null;
    minutes: number;
    isProjected: boolean;
  }[];
}

export interface WorkloadBiller {
  userId: string;
  name: string;
  role: Role;
  days: WorkloadDay[];
  totalMinutes: number;
  /** Working days in the window with nothing on them at all. */
  emptyDays: number;
  overCapacityDays: number;
}

export interface WorkloadAlert {
  userId: string;
  userName: string;
  severity: "amber" | "red";
  message: string;
  /** Where the spare capacity might go, when there is somewhere obvious. */
  suggestion?: string;
}

export interface WorkloadResult {
  dates: string[];
  targetMinutesPerDay: number;
  billers: WorkloadBiller[];
  summary: {
    overCapacity: number;
    underAssigned: number;
    unassignedCapacityHours: number;
    daysWithGaps: number;
  };
  alerts: WorkloadAlert[];
}

/** Below this a working day counts as under-assigned. */
const UNDER_ASSIGNED_MINUTES = 6 * 60;

/** How far over target a day has to go before it is over capacity. */
const OVER_CAPACITY_TOLERANCE = 0.5 * 60;

/** Every UTC day from `from` to `to`, inclusive. */
function daysBetween(from: Date, to: Date): string[] {
  const days: string[] = [];
  const cursor = new Date(from.getTime());

  while (cursor <= to && days.length < 200) {
    days.push(toIsoDate(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return days;
}

export async function getWorkloadData(params: {
  from: Date;
  to: Date;
  practiceIds?: string[];
  userIds?: string[];
  /** 7.5 or 8, as hours. */
  targetHoursPerDay: number;
}): Promise<WorkloadResult> {
  const dates = daysBetween(params.from, params.to);
  const targetMinutesPerDay = Math.round(params.targetHoursPerDay * 60);
  const today = toIsoDate(dayStart());

  const [billers, tasks, sessions, projected] = await Promise.all([
    prisma.user.findMany({
      where: {
        isActive: true,
        role: { in: [Role.BILLER, Role.PROJECT_MANAGER] },
        ...(params.userIds?.length ? { id: { in: params.userIds } } : {}),
        ...(params.practiceIds?.length
          ? { practices: { some: { practiceId: { in: params.practiceIds } } } }
          : {}),
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true, role: true },
    }),
    /** Assigned work with a due date in the window — the future half. */
    prisma.task.findMany({
      where: {
        dueDate: { gte: params.from, lte: params.to },
        isRecurring: false,
        ...(params.userIds?.length
          ? { assignedToId: { in: params.userIds } }
          : {}),
        ...(params.practiceIds?.length
          ? { practiceId: { in: params.practiceIds } }
          : {}),
      },
      select: {
        id: true,
        title: true,
        dueDate: true,
        status: true,
        estimatedMinutes: true,
        assignedToId: true,
        practiceId: true,
        practice: { select: { name: true } },
        taskType: { select: { name: true } },
      },
    }),
    /** Time actually recorded — the past half. */
    prisma.taskTimeLog.findMany({
      where: {
        startedAt: { gte: params.from, lte: params.to },
        stoppedAt: { not: null },
        ...(params.userIds?.length ? { userId: { in: params.userIds } } : {}),
        ...(params.practiceIds?.length
          ? { task: { practiceId: { in: params.practiceIds } } }
          : {}),
      },
      select: {
        userId: true,
        startedAt: true,
        durationMinutes: true,
        task: {
          select: {
            title: true,
            practice: { select: { name: true } },
            taskType: { select: { name: true } },
          },
        },
      },
    }),
    projectRecurringTasks(params.from, params.to, {
      practiceIds: params.practiceIds,
      userIds: params.userIds,
    }),
  ]);

  /** userId → date → day. */
  const grid = new Map<string, Map<string, WorkloadDay>>();

  for (const biller of billers) {
    const days = new Map<string, WorkloadDay>();

    for (const date of dates) {
      days.set(date, {
        date,
        actualMinutes: 0,
        projectedMinutes: 0,
        totalMinutes: 0,
        isOverCapacity: false,
        isUnderAssigned: false,
        isWeekend: isWeekend(new Date(`${date}T00:00:00.000Z`)),
        isFuture: date >= today,
        items: [],
      });
    }

    grid.set(biller.id, days);
  }

  const dayFor = (userId: string, date: string) =>
    grid.get(userId)?.get(date);

  // Past days read from the timer; future days from what is assigned.
  for (const session of sessions) {
    const date = toIsoDate(session.startedAt);
    if (date >= today) continue;

    const day = dayFor(session.userId, date);
    if (!day) continue;

    day.actualMinutes += session.durationMinutes ?? 0;
    day.items.push({
      label:
        session.task.taskType?.name ?? session.task.title ?? "Task",
      practiceName: session.task.practice?.name ?? null,
      minutes: session.durationMinutes ?? 0,
      isProjected: false,
    });
  }

  for (const task of tasks) {
    if (!task.dueDate) continue;

    const date = toIsoDate(task.dueDate);
    if (date < today) continue;

    // A task already closed is not still occupying the day it was due on.
    if (task.status === TaskStatus.CLOSED) continue;

    const day = dayFor(task.assignedToId, date);
    if (!day) continue;

    day.actualMinutes += task.estimatedMinutes ?? 0;
    day.items.push({
      label: task.taskType?.name ?? task.title ?? "Task",
      practiceName: task.practice?.name ?? null,
      minutes: task.estimatedMinutes ?? 0,
      isProjected: false,
    });
  }

  for (const projection of projected) {
    const date = toIsoDate(projection.dueDate);
    if (date < today) continue;

    const day = dayFor(projection.billerUserId, date);
    if (!day) continue;

    day.projectedMinutes += projection.estimatedMinutes;
    day.items.push({
      label: projection.taskTypeName ?? projection.parentTaskLabel,
      practiceName: projection.practiceName,
      minutes: projection.estimatedMinutes,
      isProjected: true,
    });
  }

  const rows: WorkloadBiller[] = billers.map((biller) => {
    const days = dates.map((date) => {
      const day = dayFor(biller.id, date)!;

      day.totalMinutes = day.actualMinutes + day.projectedMinutes;

      // A weekend has no target, so it is neither short nor over.
      if (!day.isWeekend) {
        day.isOverCapacity =
          day.totalMinutes > targetMinutesPerDay + OVER_CAPACITY_TOLERANCE;
        day.isUnderAssigned =
          day.totalMinutes > 0 && day.totalMinutes < UNDER_ASSIGNED_MINUTES;
      }

      return day;
    });

    const workingDays = days.filter((day) => !day.isWeekend);

    return {
      userId: biller.id,
      name: biller.name,
      role: biller.role,
      days,
      totalMinutes: days.reduce((sum, day) => sum + day.totalMinutes, 0),
      emptyDays: workingDays.filter((day) => day.totalMinutes === 0).length,
      overCapacityDays: workingDays.filter((day) => day.isOverCapacity).length,
    };
  });

  /* ------------------------------- alerts -------------------------------- */

  const alerts: WorkloadAlert[] = [];

  for (const biller of rows) {
    const future = biller.days.filter((day) => day.isFuture && !day.isWeekend);
    if (future.length === 0) continue;

    const empty = future.filter((day) => day.totalMinutes === 0);
    const over = future.filter((day) => day.isOverCapacity);

    if (over.length > 0) {
      alerts.push({
        userId: biller.userId,
        userName: biller.name,
        severity: "red",
        message: `${biller.name} is over capacity on ${over
          .map((day) => weekdayName(day.date))
          .join(" and ")}.`,
        suggestion:
          "Move a task to somebody with room, or push its due date.",
      });
    }

    if (empty.length >= 2) {
      alerts.push({
        userId: biller.userId,
        userName: biller.name,
        severity: "amber",
        message: `${biller.name} has ${empty.length} unassigned day${
          empty.length === 1 ? "" : "s"
        } in this range.`,
      });
    }
  }

  const futureWorking = (biller: WorkloadBiller) =>
    biller.days.filter((day) => day.isFuture && !day.isWeekend);

  const unassignedMinutes = rows.reduce((sum, biller) => {
    return (
      sum +
      futureWorking(biller).reduce(
        (dayed, day) =>
          dayed + Math.max(0, targetMinutesPerDay - day.totalMinutes),
        0,
      )
    );
  }, 0);

  return {
    dates,
    targetMinutesPerDay,
    billers: rows,
    summary: {
      overCapacity: rows.filter((biller) => biller.overCapacityDays > 0).length,
      underAssigned: rows.filter((biller) => {
        const working = futureWorking(biller);
        if (working.length === 0) return false;

        const short = working.filter(
          (day) => day.totalMinutes < UNDER_ASSIGNED_MINUTES,
        ).length;

        // "Most days", not "any day" — one quiet Friday is not a problem.
        return short > working.length / 2;
      }).length,
      unassignedCapacityHours: Math.round((unassignedMinutes / 60) * 10) / 10,
      daysWithGaps: rows.reduce((sum, biller) => sum + biller.emptyDays, 0),
    },
    alerts,
  };
}

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function weekdayName(iso: string): string {
  return WEEKDAYS[new Date(`${iso}T00:00:00.000Z`).getUTCDay()]!;
}
