import { TaskStatus } from "@/lib/generated/prisma/enums";
import { centsToDecimalString, toCents } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import {
  practiceFilterFor,
  type ProductivityQuery,
  type TaskTypeProductivity,
} from "@/lib/productivity/types";

/**
 * Time and task-type output behind the team table.
 *
 * Time comes from `task_time_logs` and is selected by **`startedAt`**, the
 * same rule the Time Logs module uses — so the hours on this page and the
 * hours on /productivity/time-logs are the same hours. A running timer has no
 * duration yet and is left out.
 */

const UNTYPED = "No type";

function sessionWhere(query: ProductivityQuery) {
  const practices = practiceFilterFor(query);

  return {
    userId: query.userId,
    startedAt: { gte: query.from, lte: query.to },
    stoppedAt: { not: null },
    ...(Object.keys(practices).length > 0 ? { task: practices } : {}),
  };
}

/** Every minute this person logged in the window. */
export async function getLoggedMinutes(
  query: ProductivityQuery,
): Promise<number> {
  const total = await prisma.taskTimeLog.aggregate({
    where: sessionWhere(query),
    _sum: { durationMinutes: true },
  });

  return total._sum.durationMinutes ?? 0;
}

/**
 * Closed tasks grouped by type, with the time logged against each.
 *
 * Only types with a closed task in the window appear: the question this
 * answers is "what did they finish", and a type they merely spent time on
 * without closing anything belongs in the time report, not here. Its minutes
 * still count towards the total.
 */
export async function getTaskTypeProductivity(
  query: ProductivityQuery,
): Promise<TaskTypeProductivity[]> {
  const [closed, sessions] = await Promise.all([
    prisma.task.findMany({
      where: {
        completedById: query.userId,
        completedAt: { gte: query.from, lte: query.to },
        status: TaskStatus.CLOSED,
        ...practiceFilterFor(query),
      },
      select: {
        taskTypeId: true,
        taskType: { select: { name: true } },
        productivityCount: true,
        productivityAmount: true,
      },
    }),
    prisma.taskTimeLog.findMany({
      where: sessionWhere(query),
      select: {
        durationMinutes: true,
        task: {
          select: { taskTypeId: true },
        },
      },
    }),
  ]);

  const minutesByType = new Map<string, number>();

  for (const session of sessions) {
    const key = session.task.taskTypeId ?? "none";
    minutesByType.set(
      key,
      (minutesByType.get(key) ?? 0) + (session.durationMinutes ?? 0),
    );
  }

  interface Accumulator {
    taskTypeId: string | null;
    taskTypeName: string;
    count: number;
    taskCount: number;
    /** Cents, so the money never touches a float. */
    amountCents: bigint;
    hasAmount: boolean;
  }

  const byType = new Map<string, Accumulator>();

  for (const task of closed) {
    const key = task.taskTypeId ?? "none";

    const entry = byType.get(key) ?? {
      taskTypeId: task.taskTypeId,
      taskTypeName: task.taskType?.name ?? UNTYPED,
      count: 0,
      taskCount: 0,
      amountCents: 0n,
      hasAmount: false,
    };

    entry.taskCount += 1;
    entry.count += task.productivityCount ?? 0;

    if (task.productivityAmount !== null) {
      entry.amountCents += toCents(task.productivityAmount.toString());
      entry.hasAmount = true;
    }

    byType.set(key, entry);
  }

  return Array.from(byType.entries())
    .map(([key, entry]) => ({
      taskTypeId: entry.taskTypeId,
      taskTypeName: entry.taskTypeName,
      count: entry.count,
      taskCount: entry.taskCount,
      totalAmount: entry.hasAmount ? centsToDecimalString(entry.amountCents) : null,
      loggedMinutes: minutesByType.get(key) ?? 0,
    }))
    .sort((a, b) => b.loggedMinutes - a.loggedMinutes || b.taskCount - a.taskCount);
}
