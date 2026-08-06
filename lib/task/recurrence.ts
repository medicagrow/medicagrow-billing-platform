import type { Task } from "@/lib/generated/prisma/client";
import { TaskStatus } from "@/lib/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_SWEEP_INTERVAL_MS,
  runAtMostEvery,
} from "@/lib/lazy-schedule";
import { dayStart } from "@/lib/todo/access";
import {
  nextOccurrence,
  parseRecurringConfig,
  toIsoDate,
  toUtcDate,
  upcomingOccurrences,
  type RecurringConfig,
} from "@/lib/task/recurrence-config";

export * from "@/lib/task/recurrence-config";

/**
 * Recurring tasks use a parent/instance pattern.
 *
 * The parent holds the recurrence config and never appears in a work queue —
 * it is the template. Each occurrence is a child Task with its own status,
 * due date and completion record, so the history of "did we do this last
 * Tuesday" survives independently of the schedule.
 *
 * `recurringConfig.nextDueDate` on the parent is the high-water mark: the
 * first occurrence not yet generated. Every generator advances it, so two
 * concurrent calls cannot both claim the same date.
 *
 * **An occurrence is only created once it is due.** Only the very first one is
 * written up front, so the series is real the moment it is set up; every later
 * occurrence appears on its own due date. A queue full of tasks dated next
 * week is noise, and closing one early would record work against a day that
 * has not happened.
 *
 * There is no scheduler in this deployment, so `generateDueInstances()` runs
 * from the places people actually load — `GET /api/tasks`,
 * `GET /api/tasks/my-tasks` and the dashboard — exactly as
 * `checkHoldReleases()` does.
 */

/**
 * How many missed occurrences one sweep will create for a single series.
 *
 * A week of catch-up is a long weekend or a holiday, and that work is real. A
 * series dormant for longer than that has gone stale: dropping a month of
 * backdated daily tasks into someone's queue helps nobody, so the mark is
 * fast-forwarded to the current occurrence instead.
 */
const MAX_CATCH_UP = 7;

/** Fields a child instance inherits from its parent. */
function instanceDataFrom(parent: Task, dueDate: Date, instanceNumber: number) {
  return {
    title: parent.title,
    description: parent.description,
    practiceId: parent.practiceId,
    taskTypeId: parent.taskTypeId,
    createdById: parent.createdById,
    assignedToId: parent.assignedToId,
    estimatedMinutes: parent.estimatedMinutes,
    priority: parent.priority,
    tags: parent.tags,
    isVisibleToCreator: parent.isVisibleToCreator,
    dueDate,
    parentTaskId: parent.id,
    instanceNumber,
    status: TaskStatus.OPEN,
  };
}

/** Highest instance number issued so far, 0 when none. */
async function lastInstanceNumber(parentTaskId: string): Promise<number> {
  const latest = await prisma.task.findFirst({
    where: { parentTaskId },
    orderBy: { instanceNumber: "desc" },
    select: { instanceNumber: true },
  });

  return latest?.instanceNumber ?? 0;
}

/** Writes the parent's new high-water mark, or leaves it where the series ended. */
async function advanceMark(
  parentId: string,
  config: RecurringConfig,
  nextDueDate: string | null,
) {
  await prisma.task.update({
    where: { id: parentId },
    data: {
      recurringConfig: (nextDueDate
        ? { ...config, nextDueDate }
        : { ...config }) as object,
    },
  });
}

/** Creates one occurrence unless that date is already scheduled. */
async function writeInstance(parent: Task, dueDate: Date): Promise<Task | null> {
  // Generating twice for one date would double the work rather than repeat it.
  const clash = await prisma.task.findFirst({
    where: { parentTaskId: parent.id, dueDate },
    select: { id: true },
  });

  if (clash) return null;

  return prisma.task.create({
    data: instanceDataFrom(
      parent,
      dueDate,
      (await lastInstanceNumber(parent.id)) + 1,
    ),
  });
}

/**
 * Creates the occurrence the parent's mark points at, but **only once it is
 * due**, and advances the mark past it.
 *
 * Called when an instance is closed. If the next occurrence is still in the
 * future the mark is left alone and nothing is written — `generateDueInstances()`
 * picks it up on the day itself. Returns null in that case, as it does when the
 * series has ended or the date is already scheduled.
 */
export async function createNextInstance(parent: Task): Promise<Task | null> {
  const config = parseRecurringConfig(parent.recurringConfig);
  if (!config || !parent.isRecurring) return null;

  if (config.endDate && config.nextDueDate > config.endDate) return null;

  // Not due yet: the mark already names it, so there is nothing to do.
  if (config.nextDueDate > toIsoDate(dayStart())) return null;

  const dueDate = toUtcDate(config.nextDueDate);
  const created = await writeInstance(parent, dueDate);

  // Advance whether or not a row was written, so a clash cannot wedge the
  // series on one date forever.
  const following = nextOccurrence(config, dueDate);
  await advanceMark(parent.id, config, following ? toIsoDate(following) : null);

  return created;
}

/**
 * Creates the first occurrence when a recurring task is set up.
 *
 * Exactly one, even when the start date is in the future — the series has to
 * exist as something you can see and open, but the occurrences after it wait
 * for their own due dates.
 */
export async function generateFirstInstance(parent: Task): Promise<Task | null> {
  const config = parseRecurringConfig(parent.recurringConfig);
  if (!config || !parent.isRecurring) return null;

  const [first] = upcomingOccurrences(config, 1);
  if (!first) return null;

  const created = await writeInstance(parent, first);

  const following = nextOccurrence(config, first);
  await advanceMark(parent.id, config, following ? toIsoDate(following) : null);

  return created;
}

export interface DueInstanceResult {
  /** Occurrences written. */
  created: number;
  /** Series that produced at least one. */
  series: number;
}

/**
 * Creates every occurrence that has come due, for every live series.
 *
 * This is the scheduler: there is no cron in this deployment, so it runs from
 * the routes people load. It is cheap when there is nothing to do — recurring
 * parents are templates, so there are few of them, and a series whose mark is
 * still in the future is skipped without a write.
 */
export async function generateDueInstances(options?: {
  /** Narrows the sweep to one person's series. */
  assignedToId?: string;
}): Promise<DueInstanceResult> {
  const today = toIsoDate(dayStart());

  const parents = await prisma.task.findMany({
    where: {
      isRecurring: true,
      status: { not: TaskStatus.CLOSED },
      ...(options?.assignedToId ? { assignedToId: options.assignedToId } : {}),
    },
  });

  let created = 0;
  let series = 0;

  for (const parent of parents) {
    const config = parseRecurringConfig(parent.recurringConfig);
    if (!config || config.nextDueDate > today) continue;

    // Walk the schedule in memory first: one pass, no reload between dates.
    const due: string[] = [];
    let cursor: string | null = config.nextDueDate;

    while (cursor && cursor <= today && due.length < 400) {
      due.push(cursor);
      const following = nextOccurrence(config, toUtcDate(cursor));
      cursor = following ? toIsoDate(following) : null;
    }

    if (due.length === 0) continue;

    // Past the cap, the skipped dates are abandoned rather than backfilled.
    const toCreate = due.slice(-MAX_CATCH_UP);
    let wrote = false;

    for (const date of toCreate) {
      const instance = await writeInstance(parent, toUtcDate(date));
      if (instance) {
        created += 1;
        wrote = true;
      }
    }

    if (wrote) series += 1;

    await advanceMark(parent.id, config, cursor);
  }

  return { created, series };
}

/**
 * Which task ids a delete covers.
 *
 *   this   — just the one named
 *   future — it and every later occurrence of the same series
 *   all    — the whole series: parent, children, history and all
 *
 * A task with no series returns itself whatever the scope, so the caller does
 * not have to special-case the ordinary delete.
 */
export async function taskIdsForDeletion(
  task: {
    id: string;
    isRecurring: boolean;
    parentTaskId: string | null;
    dueDate: Date | null;
  },
  scope: "this" | "future" | "all",
): Promise<string[]> {
  const seriesId = task.isRecurring ? task.id : task.parentTaskId;

  if (!seriesId || scope === "this") return [task.id];

  if (scope === "all") {
    const children = await prisma.task.findMany({
      where: { parentTaskId: seriesId },
      select: { id: true },
    });

    return [seriesId, ...children.map((child) => child.id)];
  }

  // "future": from this occurrence onwards. A parent has no due date of its
  // own, so deleting forward from it means every occurrence not yet past.
  const from = task.dueDate ?? dayStart();

  const later = await prisma.task.findMany({
    where: { parentTaskId: seriesId, dueDate: { gte: from } },
    select: { id: true },
  });

  return Array.from(new Set([task.id, ...later.map((row) => row.id)])).filter(
    (id) => id !== seriesId || task.isRecurring,
  );
}

/**
 * Removes tasks and everything hanging off them.
 *
 * A hard delete, not the soft delete todos use: these rows are being removed
 * because they should never have existed — a series generated too far ahead,
 * or a task raised by mistake — so leaving tombstones for the productivity
 * module to filter out would be worse than the deletion itself. Anything
 * already worked keeps its history because the caller does not offer to
 * delete it.
 */
export async function deleteTasks(taskIds: string[]): Promise<number> {
  if (taskIds.length === 0) return 0;

  await prisma.$transaction([
    prisma.taskTimeEditRequest.deleteMany({
      where: { timeLog: { taskId: { in: taskIds } } },
    }),
    prisma.taskTimeLog.deleteMany({ where: { taskId: { in: taskIds } } }),
    prisma.taskNote.deleteMany({ where: { taskId: { in: taskIds } } }),
    prisma.task.deleteMany({ where: { id: { in: taskIds } } }),
  ]);

  return taskIds.length;
}

/**
 * Closing the parent ends the series: every child still open is closed with
 * it, since they exist only to carry out the parent's schedule.
 */
export async function closeSeries(
  parentTaskId: string,
  closedById: string,
): Promise<number> {
  const now = new Date();

  const pending = await prisma.task.findMany({
    where: {
      parentTaskId,
      status: { not: TaskStatus.CLOSED },
    },
    select: { id: true },
  });

  if (pending.length === 0) return 0;

  const ids = pending.map((task) => task.id);

  await prisma.$transaction([
    prisma.task.updateMany({
      where: { id: { in: ids } },
      data: {
        status: TaskStatus.CLOSED,
        completedAt: now,
        completedById: closedById,
        holdReleaseDate: null,
      },
    }),
    prisma.taskNote.createMany({
      data: ids.map((taskId) => ({
        taskId,
        note: "Closed with the recurring series.",
        statusChangedTo: TaskStatus.CLOSED,
        addedById: closedById,
      })),
    }),
  ]);

  return ids.length;
}

export type { RecurringConfig };

/**
 * The sweep, rate limited per instance.
 *
 * This is what the request path should call. `generateDueInstances()` stays
 * exported and ungated for the places that must not skip — tests, and any
 * future cron — but a page load does not need to re-check a day-granular
 * schedule on every request.
 */
export async function generateDueInstancesIfNeeded(options?: {
  assignedToId?: string;
}): Promise<void> {
  await runAtMostEvery(
    `due-instances:${options?.assignedToId ?? "all"}`,
    DEFAULT_SWEEP_INTERVAL_MS,
    () => generateDueInstances(options),
  );
}
