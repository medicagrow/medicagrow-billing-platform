import type { Prisma } from "@/lib/generated/prisma/client";
import { TaskStatus } from "@/lib/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { getTaskLabel } from "@/lib/task/task-label";

/**
 * Time and efficiency analysis.
 *
 * Two decisions shape everything here:
 *
 *  1. **Sessions are the unit of time, tasks are the unit of estimate.** A
 *     task's logged minutes come from its TaskTimeLog rows; its estimate is a
 *     single number on the task. Summing the estimate per session would count
 *     it once per session rather than once per task, so estimates are gathered
 *     from the distinct tasks the sessions touched.
 *
 *  2. **A task with no estimate is excluded from efficiency, not counted as
 *     zero.** Dividing by a missing estimate is not a 0% efficiency, it is an
 *     unanswerable question — and treating it as zero would make every
 *     unestimated task look infinitely over budget.
 */

/** Logged ÷ estimated, as a percentage. Null when there is nothing to divide by. */
export function efficiencyRate(
  loggedMinutes: number,
  estimatedMinutes: number,
): number | null {
  if (estimatedMinutes <= 0) return null;
  return Math.round((loggedMinutes / estimatedMinutes) * 1000) / 10;
}

/**
 * A task is over budget when it has an estimate and has logged past it.
 * No estimate means no budget to overrun.
 */
export function isOverrun(
  loggedMinutes: number,
  estimatedMinutes: number | null,
): boolean {
  return estimatedMinutes !== null && estimatedMinutes > 0 && loggedMinutes > estimatedMinutes;
}

export interface TimeLogFilters {
  from: Date;
  to: Date;
  userIds?: string[];
  practiceIds?: string[];
  taskTypeIds?: string[];
}

/**
 * Sessions are selected by when they *started*, so a period's numbers never
 * change afterwards — the same rule the AR productivity counts follow.
 */
export function sessionWhere(
  filters: TimeLogFilters,
): Prisma.TaskTimeLogWhereInput {
  return {
    startedAt: { gte: filters.from, lte: filters.to },
    // An unstopped timer has no duration yet and would read as zero.
    stoppedAt: { not: null },
    ...(filters.userIds?.length ? { userId: { in: filters.userIds } } : {}),
    ...(filters.practiceIds?.length || filters.taskTypeIds?.length
      ? {
          task: {
            ...(filters.practiceIds?.length
              ? { practiceId: { in: filters.practiceIds } }
              : {}),
            ...(filters.taskTypeIds?.length
              ? { taskTypeId: { in: filters.taskTypeIds } }
              : {}),
          },
        }
      : {}),
  };
}

const NO_TYPE = "No type";

interface Totals {
  logged: number;
  estimated: number;
}

const zero = (): Totals => ({ logged: 0, estimated: 0 });

export interface TimeLogSummary {
  totalLoggedMinutes: number;
  totalEstimatedMinutes: number;
  efficiencyRate: number | null;
  overrunTaskCount: number;
  sessionCount: number;
  byBiller: BillerSummary[];
  byPractice: PracticeSummary[];
  byTaskType: TaskTypeSummary[];
  overrunTasks: OverrunTask[];
}

export interface BillerSummary {
  userId: string;
  userName: string;
  totalLoggedMinutes: number;
  totalEstimatedMinutes: number;
  efficiencyRate: number | null;
  overrunCount: number;
  sessionCount: number;
  byTaskType: {
    taskTypeName: string;
    loggedMinutes: number;
    estimatedMinutes: number;
    efficiencyRate: number | null;
    taskCount: number;
  }[];
}

export interface PracticeSummary {
  practiceId: string;
  practiceName: string;
  totalLoggedMinutes: number;
  totalEstimatedMinutes: number;
  efficiencyRate: number | null;
  billerCount: number;
}

export interface TaskTypeSummary {
  taskTypeId: string;
  taskTypeName: string;
  totalLoggedMinutes: number;
  totalEstimatedMinutes: number;
  avgLoggedMinutes: number;
  avgEstimatedMinutes: number;
  efficiencyRate: number | null;
  taskCount: number;
  billerCount: number;
}

export interface OverrunTask {
  taskId: string;
  taskLabel: string;
  practiceName: string;
  assignedToName: string;
  estimatedMinutes: number;
  loggedMinutes: number;
  overrunMinutes: number;
  overrunPercent: number;
  status: TaskStatus;
}

export async function getTimeLogSummary(
  filters: TimeLogFilters,
): Promise<TimeLogSummary> {
  const sessions = await prisma.taskTimeLog.findMany({
    where: sessionWhere(filters),
    select: {
      durationMinutes: true,
      userId: true,
      user: { select: { name: true } },
      task: {
        select: {
          id: true,
          title: true,
          status: true,
          estimatedMinutes: true,
          taskTypeId: true,
          taskType: { select: { name: true } },
          practiceId: true,
          practice: { select: { name: true } },
          assignedTo: { select: { name: true } },
        },
      },
    },
  });

  /**
   * Logged minutes per (task, biller): a task worked by two people splits
   * between them, but its estimate belongs to the task as a whole.
   */
  const loggedByTaskAndUser = new Map<string, number>();
  const tasksById = new Map<string, (typeof sessions)[number]["task"]>();
  const billerNames = new Map<string, string>();

  let totalLoggedMinutes = 0;

  for (const session of sessions) {
    const minutes = session.durationMinutes ?? 0;
    totalLoggedMinutes += minutes;

    tasksById.set(session.task.id, session.task);
    billerNames.set(session.userId, session.user.name);

    const key = `${session.task.id}:${session.userId}`;
    loggedByTaskAndUser.set(key, (loggedByTaskAndUser.get(key) ?? 0) + minutes);
  }

  // Logged minutes per task, across everyone who worked it.
  const loggedByTask = new Map<string, number>();
  for (const [key, minutes] of loggedByTaskAndUser) {
    const taskId = key.split(":")[0]!;
    loggedByTask.set(taskId, (loggedByTask.get(taskId) ?? 0) + minutes);
  }

  // Estimates are counted once per task, not once per session.
  let totalEstimatedMinutes = 0;
  for (const task of tasksById.values()) {
    totalEstimatedMinutes += task.estimatedMinutes ?? 0;
  }

  /* ------------------------------ overruns ------------------------------ */

  const overrunTasks: OverrunTask[] = [];

  for (const [taskId, logged] of loggedByTask) {
    const task = tasksById.get(taskId)!;
    if (!isOverrun(logged, task.estimatedMinutes)) continue;

    const estimated = task.estimatedMinutes!;
    const over = logged - estimated;

    overrunTasks.push({
      taskId,
      taskLabel: getTaskLabel(task),
      practiceName: task.practice?.name ?? "—",
      assignedToName: task.assignedTo?.name ?? "—",
      estimatedMinutes: estimated,
      loggedMinutes: logged,
      overrunMinutes: over,
      overrunPercent: Math.round((over / estimated) * 1000) / 10,
      status: task.status,
    });
  }

  overrunTasks.sort((a, b) => b.overrunPercent - a.overrunPercent);

  /* ------------------------------ by biller ----------------------------- */

  const billerTotals = new Map<string, Totals>();
  const billerSessions = new Map<string, number>();
  const billerOverruns = new Map<string, number>();
  const billerTypeTotals = new Map<string, Map<string, Totals>>();
  const billerTypeTasks = new Map<string, Map<string, Set<string>>>();

  for (const [key, minutes] of loggedByTaskAndUser) {
    const [taskId, userId] = key.split(":") as [string, string];
    const task = tasksById.get(taskId)!;
    const typeName = task.taskType?.name ?? NO_TYPE;

    const totals = billerTotals.get(userId) ?? zero();
    totals.logged += minutes;
    totals.estimated += task.estimatedMinutes ?? 0;
    billerTotals.set(userId, totals);

    const byType = billerTypeTotals.get(userId) ?? new Map<string, Totals>();
    const typeTotals = byType.get(typeName) ?? zero();
    typeTotals.logged += minutes;
    typeTotals.estimated += task.estimatedMinutes ?? 0;
    byType.set(typeName, typeTotals);
    billerTypeTotals.set(userId, byType);

    const typeTasks = billerTypeTasks.get(userId) ?? new Map<string, Set<string>>();
    const set = typeTasks.get(typeName) ?? new Set<string>();
    set.add(taskId);
    typeTasks.set(typeName, set);
    billerTypeTasks.set(userId, typeTasks);

    // A task is attributed as an overrun to everyone who logged against it —
    // the alternative, picking one, would hide the rest of the contribution.
    if (isOverrun(loggedByTask.get(taskId) ?? 0, task.estimatedMinutes)) {
      billerOverruns.set(userId, (billerOverruns.get(userId) ?? 0) + 1);
    }
  }

  for (const session of sessions) {
    billerSessions.set(
      session.userId,
      (billerSessions.get(session.userId) ?? 0) + 1,
    );
  }

  const byBiller: BillerSummary[] = Array.from(billerTotals.entries())
    .map(([userId, totals]) => ({
      userId,
      userName: billerNames.get(userId) ?? "Unknown",
      totalLoggedMinutes: totals.logged,
      totalEstimatedMinutes: totals.estimated,
      efficiencyRate: efficiencyRate(totals.logged, totals.estimated),
      overrunCount: billerOverruns.get(userId) ?? 0,
      sessionCount: billerSessions.get(userId) ?? 0,
      byTaskType: Array.from(
        (billerTypeTotals.get(userId) ?? new Map<string, Totals>()).entries(),
      )
        .map(([taskTypeName, typeTotals]) => ({
          taskTypeName,
          loggedMinutes: typeTotals.logged,
          estimatedMinutes: typeTotals.estimated,
          efficiencyRate: efficiencyRate(typeTotals.logged, typeTotals.estimated),
          taskCount:
            billerTypeTasks.get(userId)?.get(taskTypeName)?.size ?? 0,
        }))
        .sort((a, b) => b.loggedMinutes - a.loggedMinutes),
    }))
    .sort((a, b) => b.totalLoggedMinutes - a.totalLoggedMinutes);

  /* ----------------------------- by practice ---------------------------- */

  const practiceTotals = new Map<string, Totals>();
  const practiceNames = new Map<string, string>();
  const practiceBillers = new Map<string, Set<string>>();

  for (const [key, minutes] of loggedByTaskAndUser) {
    const [taskId, userId] = key.split(":") as [string, string];
    const task = tasksById.get(taskId)!;

    // Tasks with no practice are grouped rather than dropped.
    const practiceId = task.practiceId ?? "none";
    practiceNames.set(practiceId, task.practice?.name ?? "No practice");

    const totals = practiceTotals.get(practiceId) ?? zero();
    totals.logged += minutes;
    totals.estimated += task.estimatedMinutes ?? 0;
    practiceTotals.set(practiceId, totals);

    const billers = practiceBillers.get(practiceId) ?? new Set<string>();
    billers.add(userId);
    practiceBillers.set(practiceId, billers);
  }

  const byPractice: PracticeSummary[] = Array.from(practiceTotals.entries())
    .map(([practiceId, totals]) => ({
      practiceId,
      practiceName: practiceNames.get(practiceId) ?? "No practice",
      totalLoggedMinutes: totals.logged,
      totalEstimatedMinutes: totals.estimated,
      efficiencyRate: efficiencyRate(totals.logged, totals.estimated),
      billerCount: practiceBillers.get(practiceId)?.size ?? 0,
    }))
    .sort((a, b) => b.totalLoggedMinutes - a.totalLoggedMinutes);

  /* ---------------------------- by task type ---------------------------- */

  const typeTotals = new Map<string, Totals>();
  const typeNames = new Map<string, string>();
  const typeTasks = new Map<string, Set<string>>();
  const typeBillers = new Map<string, Set<string>>();

  for (const [key, minutes] of loggedByTaskAndUser) {
    const [taskId, userId] = key.split(":") as [string, string];
    const task = tasksById.get(taskId)!;
    const typeId = task.taskTypeId ?? "none";

    typeNames.set(typeId, task.taskType?.name ?? NO_TYPE);

    const totals = typeTotals.get(typeId) ?? zero();
    totals.logged += minutes;
    typeTotals.set(typeId, totals);

    const tasks = typeTasks.get(typeId) ?? new Set<string>();
    tasks.add(taskId);
    typeTasks.set(typeId, tasks);

    const billers = typeBillers.get(typeId) ?? new Set<string>();
    billers.add(userId);
    typeBillers.set(typeId, billers);
  }

  // Estimates once per task, so the average is per task rather than per session.
  for (const [typeId, tasks] of typeTasks) {
    const totals = typeTotals.get(typeId)!;
    totals.estimated = Array.from(tasks).reduce(
      (sum, taskId) => sum + (tasksById.get(taskId)?.estimatedMinutes ?? 0),
      0,
    );
  }

  const byTaskType: TaskTypeSummary[] = Array.from(typeTotals.entries())
    .map(([taskTypeId, totals]) => {
      const taskCount = typeTasks.get(taskTypeId)?.size ?? 0;

      return {
        taskTypeId,
        taskTypeName: typeNames.get(taskTypeId) ?? NO_TYPE,
        totalLoggedMinutes: totals.logged,
        totalEstimatedMinutes: totals.estimated,
        avgLoggedMinutes: taskCount === 0 ? 0 : Math.round(totals.logged / taskCount),
        avgEstimatedMinutes:
          taskCount === 0 ? 0 : Math.round(totals.estimated / taskCount),
        efficiencyRate: efficiencyRate(totals.logged, totals.estimated),
        taskCount,
        billerCount: typeBillers.get(taskTypeId)?.size ?? 0,
      };
    })
    .sort((a, b) => b.totalLoggedMinutes - a.totalLoggedMinutes);

  return {
    totalLoggedMinutes,
    totalEstimatedMinutes,
    efficiencyRate: efficiencyRate(totalLoggedMinutes, totalEstimatedMinutes),
    overrunTaskCount: overrunTasks.length,
    sessionCount: sessions.length,
    byBiller,
    byPractice,
    byTaskType,
    overrunTasks,
  };
}
