import { TaskStatus } from "@/lib/generated/prisma/enums";
import { centsToDecimalString, toCents } from "@/lib/money";
import { prisma } from "@/lib/prisma";
import {
  practiceFilterFor,
  type TaskTypeProductivity,
  type TeamProductivityQuery,
} from "@/lib/productivity/types";

/**
 * Time and task-type output behind the team table.
 *
 * Time comes from `task_time_logs` and is selected by **`startedAt`**, the
 * same rule the Time Logs module uses — so the hours on this page and the
 * hours on /productivity/time-logs are the same hours. A running timer has no
 * duration yet and is left out.
 *
 * Everything here is asked for the whole team at once: three queries for any
 * number of people, rather than three each.
 */

const UNTYPED = "No type";

function sessionWhere(query: TeamProductivityQuery) {
  const practices = practiceFilterFor(query);

  return {
    userId: { in: query.userIds },
    startedAt: { gte: query.from, lte: query.to },
    stoppedAt: { not: null },
    ...(Object.keys(practices).length > 0 ? { task: practices } : {}),
  };
}

/** Minutes logged in the window, per person. */
export async function getLoggedMinutes(
  query: TeamProductivityQuery,
): Promise<Map<string, number>> {
  const byUser = new Map<string, number>(
    query.userIds.map((userId) => [userId, 0]),
  );

  if (query.userIds.length === 0) return byUser;

  const totals = await prisma.taskTimeLog.groupBy({
    by: ["userId"],
    where: sessionWhere(query),
    _sum: { durationMinutes: true },
  });

  for (const row of totals) {
    byUser.set(row.userId, row._sum.durationMinutes ?? 0);
  }

  return byUser;
}

interface TypeAccumulator {
  taskTypeId: string | null;
  taskTypeName: string;
  count: number;
  taskCount: number;
  /** Cents, so the money never touches a float. */
  amountCents: bigint;
  hasAmount: boolean;
}

/**
 * Closed tasks grouped by type, with the time logged against each, per person.
 *
 * Only types with a closed task in the window appear: the question this
 * answers is "what did they finish", and a type somebody merely spent time on
 * without closing anything belongs in the time report, not here. Its minutes
 * still count towards the total.
 */
export async function getTaskTypeProductivity(
  query: TeamProductivityQuery,
): Promise<Map<string, TaskTypeProductivity[]>> {
  const byUser = new Map<string, TaskTypeProductivity[]>(
    query.userIds.map((userId) => [userId, []]),
  );

  if (query.userIds.length === 0) return byUser;

  const [closed, sessions] = await Promise.all([
    prisma.task.findMany({
      where: {
        completedById: { in: query.userIds },
        completedAt: { gte: query.from, lte: query.to },
        status: TaskStatus.CLOSED,
        ...practiceFilterFor(query),
      },
      select: {
        completedById: true,
        taskTypeId: true,
        taskType: { select: { name: true } },
        productivityCount: true,
        productivityAmount: true,
      },
    }),
    prisma.taskTimeLog.findMany({
      where: sessionWhere(query),
      select: {
        userId: true,
        durationMinutes: true,
        task: { select: { taskTypeId: true } },
      },
    }),
  ]);

  /** Minutes per (person, task type). */
  const minutes = new Map<string, number>();
  const minutesKey = (userId: string, taskTypeId: string | null) =>
    `${userId}:${taskTypeId ?? "none"}`;

  for (const session of sessions) {
    const key = minutesKey(session.userId, session.task.taskTypeId);
    minutes.set(key, (minutes.get(key) ?? 0) + (session.durationMinutes ?? 0));
  }

  /** Closed-task tallies per (person, task type). */
  const tallies = new Map<string, Map<string, TypeAccumulator>>();

  for (const task of closed) {
    // completedById is non-null for anything the query matched.
    const userId = task.completedById!;
    const key = task.taskTypeId ?? "none";

    const forUser = tallies.get(userId) ?? new Map<string, TypeAccumulator>();

    const entry = forUser.get(key) ?? {
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

    forUser.set(key, entry);
    tallies.set(userId, forUser);
  }

  for (const userId of query.userIds) {
    const forUser = tallies.get(userId);
    if (!forUser) continue;

    byUser.set(
      userId,
      Array.from(forUser.entries())
        .map(([key, entry]) => ({
          taskTypeId: entry.taskTypeId,
          taskTypeName: entry.taskTypeName,
          count: entry.count,
          taskCount: entry.taskCount,
          totalAmount: entry.hasAmount
            ? centsToDecimalString(entry.amountCents)
            : null,
          loggedMinutes: minutes.get(minutesKey(userId, key === "none" ? null : key)) ?? 0,
        }))
        .sort(
          (a, b) => b.loggedMinutes - a.loggedMinutes || b.taskCount - a.taskCount,
        ),
    );
  }

  return byUser;
}
