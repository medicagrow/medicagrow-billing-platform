import type { Task } from "@/lib/generated/prisma/client";
import { TaskStatus } from "@/lib/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
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
 */

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

/**
 * Creates the next occurrence of a recurring series and advances the parent's
 * `nextDueDate`. Returns null when the series has ended, has no config, or
 * that date is already scheduled.
 */
export async function createNextInstance(parent: Task): Promise<Task | null> {
  const config = parseRecurringConfig(parent.recurringConfig);
  if (!config || !parent.isRecurring) return null;

  const dueDate = toUtcDate(config.nextDueDate);

  if (config.endDate && config.nextDueDate > config.endDate) return null;

  // Generating twice for one date would double the work rather than repeat it.
  const clash = await prisma.task.findFirst({
    where: { parentTaskId: parent.id, dueDate },
    select: { id: true },
  });

  const created = clash
    ? null
    : await prisma.task.create({
        data: instanceDataFrom(
          parent,
          dueDate,
          (await lastInstanceNumber(parent.id)) + 1,
        ),
      });

  // Advance the high-water mark whether or not a row was written, so a clash
  // cannot wedge the series on one date forever.
  const following = nextOccurrence(config, dueDate);

  await prisma.task.update({
    where: { id: parent.id },
    data: {
      recurringConfig: following
        ? ({ ...config, nextDueDate: toIsoDate(following) } as object)
        : ({ ...config } as object),
    },
  });

  return created;
}

/**
 * Creates the first `count` occurrences when a recurring task is set up, so
 * the series is visible in planning views right away rather than appearing
 * one at a time as each is completed.
 */
export async function generateInitialInstances(
  parent: Task,
  count = 3,
): Promise<Task[]> {
  const config = parseRecurringConfig(parent.recurringConfig);
  if (!config || !parent.isRecurring) return [];

  const dates = upcomingOccurrences(config, count);
  if (dates.length === 0) return [];

  const startingAt = await lastInstanceNumber(parent.id);

  const created = await Promise.all(
    dates.map((dueDate, index) =>
      prisma.task.create({
        data: instanceDataFrom(parent, dueDate, startingAt + index + 1),
      }),
    ),
  );

  // The next occurrence after the last one generated becomes the new mark.
  const last = dates[dates.length - 1]!;
  const following = nextOccurrence(config, last);

  await prisma.task.update({
    where: { id: parent.id },
    data: {
      recurringConfig: {
        ...config,
        ...(following ? { nextDueDate: toIsoDate(following) } : {}),
      } as object,
    },
  });

  return created;
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
