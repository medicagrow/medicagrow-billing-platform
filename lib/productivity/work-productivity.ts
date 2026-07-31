import { TaskStatus, TodoStatus } from "@/lib/generated/prisma/enums";
import { getTaskLabel } from "@/lib/task/task-label";
import { prisma } from "@/lib/prisma";
import {
  WORK_ACTIVITIES,
  WORK_ACTIVITY_LABELS,
  type WorkActivityKey,
} from "@/lib/productivity/work-activities";
import {
  buildDrillDownUrl,
  type ActivityBreakdown,
  type ActivityDetailPage,
  type ActivitySummary,
  type ProductivityQuery,
} from "@/lib/productivity/types";

/**
 * Task and To Do completions.
 *
 * Counts are keyed on `completedAt` falling inside the window, so a past
 * period's report never changes — the same rule the AR counts follow.
 * Completion is attributed to whoever closed the item, not the assignee.
 */
export async function getWorkProductivity(
  query: ProductivityQuery,
): Promise<ActivitySummary[]> {
  const window = {
    completedById: query.userId,
    completedAt: { gte: query.from, lte: query.to },
    ...(query.practiceId ? { practiceId: query.practiceId } : {}),
  };

  const [tasksCompleted, todosCompleted] = await Promise.all([
    prisma.task.count({ where: { ...window, status: TaskStatus.CLOSED } }),
    prisma.todo.count({ where: { ...window, status: TodoStatus.CLOSED } }),
  ]);

  const summary = (key: WorkActivityKey, count: number): ActivitySummary => ({
    module: key === WORK_ACTIVITIES.TASKS_COMPLETED ? "TASK" : "TODO",
    key,
    label: WORK_ACTIVITY_LABELS[key],
    count,
    drillDownUrl: buildDrillDownUrl(
      query.userId,
      key,
      query.from,
      query.to,
      query.practiceId,
    ),
  });

  return [
    summary(WORK_ACTIVITIES.TASKS_COMPLETED, tasksCompleted),
    summary(WORK_ACTIVITIES.TODOS_COMPLETED, todosCompleted),
  ];
}

export interface WorkActivityRow {
  id: string;
  title: string;
  practiceName: string | null;
  assignedToName: string | null;
  taskTypeName: string | null;
  priority: string;
  actualMinutes: number | null;
  completedAt: string;
}

/**
 * Completions grouped by task type, so "what kind of work was this?" can be
 * answered without reading every row. Untyped tasks are counted together
 * rather than dropped — a gap in classification is itself worth seeing.
 */
async function taskTypeBreakdown(
  where: Record<string, unknown>,
): Promise<ActivityBreakdown[]> {
  const grouped = await prisma.task.groupBy({
    by: ["taskTypeId"],
    where,
    _count: { _all: true },
  });

  const named = await prisma.taskType.findMany({
    where: {
      id: {
        in: grouped
          .map((row) => row.taskTypeId)
          .filter((id): id is string => id !== null),
      },
    },
    select: { id: true, name: true },
  });

  const nameById = new Map(named.map((type) => [type.id, type.name]));

  return grouped
    .map((row) => ({
      label: row.taskTypeId
        ? (nameById.get(row.taskTypeId) ?? "Unknown type")
        : "No type",
      count: row._count._all,
    }))
    .sort((a, b) => b.count - a.count);
}

export async function getWorkActivityDetail(
  query: ProductivityQuery & {
    activityKey: string;
    skip: number;
    take: number;
  },
): Promise<ActivityDetailPage<WorkActivityRow> | null> {
  const isTask = query.activityKey === WORK_ACTIVITIES.TASKS_COMPLETED;
  const isTodo = query.activityKey === WORK_ACTIVITIES.TODOS_COMPLETED;

  if (!isTask && !isTodo) return null;

  const where = {
    completedById: query.userId,
    completedAt: { gte: query.from, lte: query.to },
    ...(query.practiceId ? { practiceId: query.practiceId } : {}),
    ...(isTask
      ? { status: TaskStatus.CLOSED }
      : { status: TodoStatus.CLOSED }),
  };

  const include = {
    practice: { select: { name: true } },
    assignedTo: { select: { name: true } },
    ...(isTask ? { taskType: { select: { name: true } } } : {}),
  } as const;

  const args = {
    where,
    orderBy: { completedAt: "desc" as const },
    skip: query.skip,
    take: query.take,
    include,
  };

  const [rows, total] = isTask
    ? await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        prisma.task.findMany(args as any),
        prisma.task.count({ where }),
      ])
    : await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        prisma.todo.findMany(args as any),
        prisma.todo.count({ where }),
      ]);

  type Row = {
    id: string;
    title: string;
    priority: string;
    actualMinutes?: number | null;
    completedAt: Date | null;
    practice: { name: string } | null;
    assignedTo: { name: string } | null;
    taskType?: { name: string } | null;
  };

  return {
    activityKey: query.activityKey,
    label: WORK_ACTIVITY_LABELS[query.activityKey as WorkActivityKey],
    module: isTask ? "TASK" : "TODO",
    rows: (rows as unknown as Row[]).map((row) => ({
      id: row.id,
      title: row.title,
      practiceName: row.practice?.name ?? null,
      assignedToName: row.assignedTo?.name ?? null,
      taskTypeName: row.taskType?.name ?? null,
      priority: row.priority,
      actualMinutes: row.actualMinutes ?? null,
      completedAt: row.completedAt?.toISOString() ?? "",
    })),
    ...(isTask ? { breakdown: await taskTypeBreakdown(where) } : {}),
    total,
    page: Math.floor(query.skip / query.take) + 1,
    pageSize: query.take,
    totalPages: Math.max(1, Math.ceil(total / query.take)),
  };
}

/** Recent completions, for the activity timeline. */
export async function getWorkRecentActivity(
  query: ProductivityQuery,
  limit: number,
) {
  const window = {
    completedById: query.userId,
    completedAt: { gte: query.from, lte: query.to },
    ...(query.practiceId ? { practiceId: query.practiceId } : {}),
  };

  const [tasks, todos] = await Promise.all([
    prisma.task.findMany({
      where: { ...window, status: TaskStatus.CLOSED },
      orderBy: { completedAt: "desc" },
      take: limit,
      select: {
        id: true,
        title: true,
        completedAt: true,
        practice: { select: { name: true } },
        taskType: { select: { name: true } },
      },
    }),
    prisma.todo.findMany({
      where: { ...window, status: TodoStatus.CLOSED },
      orderBy: { completedAt: "desc" },
      take: limit,
      select: {
        id: true,
        title: true,
        completedAt: true,
        practice: { select: { name: true } },
      },
    }),
  ]);

  // Same row shape as the AR timeline so the page can render one list.
  return [
    ...tasks.map((task) => ({
      id: task.id,
      module: "TASK" as const,
      workedAt: task.completedAt?.toISOString() ?? "",
      recordId: task.id,
      recordLabel: getTaskLabel(task),
      recordUrl: `/tasks/list?search=${encodeURIComponent(getTaskLabel(task))}`,
      practiceName: task.practice?.name ?? "—",
      outcomeType: null,
      statusChangedTo: "Closed",
      statusCategoryChangedTo: null,
    })),
    ...todos.map((todo) => ({
      id: todo.id,
      module: "TODO" as const,
      workedAt: todo.completedAt?.toISOString() ?? "",
      recordId: todo.id,
      recordLabel: todo.title,
      recordUrl: `/todos/list?assignedToId=${query.userId}`,
      practiceName: todo.practice?.name ?? "—",
      outcomeType: null,
      statusChangedTo: "Closed",
      statusCategoryChangedTo: null,
    })),
  ];
}
