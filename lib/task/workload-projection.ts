import { TaskStatus } from "@/lib/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { getTaskLabel } from "@/lib/task/task-label";
import {
  dueDateFor,
  isWeekend,
  nextOccurrence,
  parseRecurringConfig,
  toIsoDate,
  toUtcDate,
} from "@/lib/task/recurrence-config";

/**
 * What a recurring series *will* put on somebody's plate.
 *
 * The generators deliberately create an occurrence only once it is due, which
 * is right for a work queue and useless for planning: a queue that shows only
 * today cannot answer "is Daniel free on Thursday". This walks the same
 * recurrence rules forward and reports what would be created, **without
 * writing anything**. Nothing here touches the database except to read.
 *
 * A projection is not a task. It has no id, cannot be opened, closed or
 * timed, and `isProjected` is on every row so a caller cannot mistake one for
 * real work.
 */

export interface ProjectedTask {
  billerUserId: string;
  billerName: string;
  practiceId: string | null;
  practiceName: string | null;
  taskTypeId: string | null;
  taskTypeName: string | null;
  dueDate: Date;
  estimatedMinutes: number;
  /** Always true. Present so a mixed list can be told apart at a glance. */
  isProjected: true;
  parentTaskId: string;
  parentTaskLabel: string;
}

export interface ProjectionFilters {
  practiceId?: string;
  practiceIds?: string[];
  userId?: string;
  userIds?: string[];
}

/**
 * How far a single series will be walked. A window is normally days or weeks;
 * this only stops a malformed config from spinning.
 */
const MAX_STEPS = 400;

/**
 * Every date a series would fall on between `from` and `to`.
 *
 * The walk starts at the series' own mark rather than at `from`, so a mark in
 * the past catches up to the window rather than being projected onto dates the
 * pattern never names — a weekly Tuesday series must not appear on a Thursday
 * just because the window opens then.
 */
function occurrencesInWindow(
  config: NonNullable<ReturnType<typeof parseRecurringConfig>>,
  from: Date,
  to: Date,
): Date[] {
  const dates: Date[] = [];

  const fromIso = toIsoDate(from);
  const toIso = toIsoDate(to);

  let cursorIso: string | null = dueDateFor(config, config.nextDueDate);
  let steps = 0;

  while (cursorIso && steps < MAX_STEPS) {
    steps += 1;

    if (config.endDate && cursorIso > config.endDate) break;
    if (cursorIso > toIso) break;

    if (cursorIso >= fromIso) dates.push(toUtcDate(cursorIso));

    const following = nextOccurrence(config, toUtcDate(cursorIso));
    cursorIso = following ? dueDateFor(config, toIsoDate(following)) : null;
  }

  return dates;
}

export async function projectRecurringTasks(
  from: Date,
  to: Date,
  filters: ProjectionFilters = {},
): Promise<ProjectedTask[]> {
  const practiceIds =
    filters.practiceIds && filters.practiceIds.length > 0
      ? filters.practiceIds
      : filters.practiceId
        ? [filters.practiceId]
        : undefined;

  const userIds =
    filters.userIds && filters.userIds.length > 0
      ? filters.userIds
      : filters.userId
        ? [filters.userId]
        : undefined;

  const parents = await prisma.task.findMany({
    where: {
      isRecurring: true,
      parentTaskId: null,
      status: { not: TaskStatus.CLOSED },
      ...(practiceIds ? { practiceId: { in: practiceIds } } : {}),
      ...(userIds ? { assignedToId: { in: userIds } } : {}),
    },
    select: {
      id: true,
      title: true,
      estimatedMinutes: true,
      recurringConfig: true,
      assignedToId: true,
      assignedTo: { select: { name: true } },
      practiceId: true,
      practice: { select: { name: true } },
      taskTypeId: true,
      taskType: { select: { name: true } },
    },
  });

  if (parents.length === 0) return [];

  /**
   * Occurrences the generators have already written are real tasks, and the
   * caller is counting those separately. Fetched in one query for every
   * series rather than one per series — a projection over a fortnight would
   * otherwise cost a round trip per recurring task.
   */
  const existing = await prisma.task.findMany({
    where: {
      parentTaskId: { in: parents.map((parent) => parent.id) },
      dueDate: { gte: from, lte: to },
    },
    select: { parentTaskId: true, dueDate: true },
  });

  const alreadyReal = new Set(
    existing
      .filter((task) => task.dueDate !== null)
      .map((task) => `${task.parentTaskId}:${toIsoDate(task.dueDate!)}`),
  );

  const projected: ProjectedTask[] = [];

  for (const parent of parents) {
    const config = parseRecurringConfig(parent.recurringConfig);
    if (!config) continue;

    const label = getTaskLabel(parent);

    for (const dueDate of occurrencesInWindow(config, from, to)) {
      const iso = toIsoDate(dueDate);

      if (alreadyReal.has(`${parent.id}:${iso}`)) continue;

      // Belt and braces: the walk already avoids weekends for daily series,
      // and a projection landing on one would be planning work nobody does.
      if (config.frequency === "daily" && isWeekend(dueDate)) continue;

      projected.push({
        billerUserId: parent.assignedToId,
        billerName: parent.assignedTo.name,
        practiceId: parent.practiceId,
        practiceName: parent.practice?.name ?? null,
        taskTypeId: parent.taskTypeId,
        taskTypeName: parent.taskType?.name ?? null,
        dueDate,
        // A series with no estimate projects no load rather than a guess.
        estimatedMinutes: parent.estimatedMinutes ?? 0,
        isProjected: true,
        parentTaskId: parent.id,
        parentTaskLabel: label,
      });
    }
  }

  return projected.sort(
    (a, b) => a.dueDate.getTime() - b.dueDate.getTime(),
  );
}
