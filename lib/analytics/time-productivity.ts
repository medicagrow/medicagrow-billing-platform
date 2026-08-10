import { prisma } from "@/lib/prisma";
import {
  addMeasures,
  closedTaskWhere,
  efficiencyRate,
  emptyMeasures,
  groupKey,
  secondsPerUnit,
  sessionWhere,
  totalMeasures,
  UNASSIGNED_PRACTICE,
  UNTYPED,
  type AnalyticsFilters,
  type Measures,
} from "@/lib/analytics/shared";

/**
 * Time against output, sliced three ways.
 *
 * The same numbers answer three questions depending on what you put at the
 * top: "who is slow", "which practice costs most", "which kind of work eats
 * the day". So the data is gathered once into (biller × practice × task type)
 * cells and the hierarchy is built from whichever order was asked for —
 * rather than three queries that could disagree.
 *
 * **Two queries, whatever the size of the team.** The previous version of this
 * module ran a set per person; a report over fifteen people was 165 round
 * trips before the database did any real work.
 */

export type GroupDimension = "biller" | "practice" | "taskType";

export interface GroupNode extends Measures {
  key: string;
  label: string;
  efficiencyRate: number | null;
  secondsPerUnit: number | null;
  children: GroupNode[];
}

export interface TimeProductivityResult {
  groupBy: GroupDimension[];
  rows: GroupNode[];
  total: Measures & {
    efficiencyRate: number | null;
    secondsPerUnit: number | null;
  };
}

/** One cell of the cube, before it is folded into a hierarchy. */
interface Cell extends Measures {
  billerId: string;
  billerName: string;
  practiceId: string;
  practiceName: string;
  taskTypeId: string;
  taskTypeName: string;
}

/** The order the three dimensions nest in, for each top-level choice. */
const HIERARCHY: Record<GroupDimension, GroupDimension[]> = {
  biller: ["biller", "practice", "taskType"],
  practice: ["practice", "biller", "taskType"],
  taskType: ["taskType", "biller", "practice"],
};

function dimensionOf(cell: Cell, dimension: GroupDimension) {
  if (dimension === "biller") {
    return { key: cell.billerId, label: cell.billerName };
  }

  if (dimension === "practice") {
    return { key: cell.practiceId, label: cell.practiceName };
  }

  return { key: cell.taskTypeId, label: cell.taskTypeName };
}

/** Folds cells into a tree, deepest level last. */
function nest(cells: Cell[], dimensions: GroupDimension[]): GroupNode[] {
  if (dimensions.length === 0) return [];

  const [dimension, ...rest] = dimensions as [GroupDimension, ...GroupDimension[]];
  const groups = new Map<string, { label: string; cells: Cell[] }>();

  for (const cell of cells) {
    const { key, label } = dimensionOf(cell, dimension);
    const group = groups.get(key) ?? { label, cells: [] };

    group.cells.push(cell);
    groups.set(key, group);
  }

  return Array.from(groups.entries())
    .map(([key, group]) => {
      const measures = totalMeasures(group.cells);

      return {
        key,
        label: group.label,
        ...measures,
        efficiencyRate: efficiencyRate(measures),
        secondsPerUnit: secondsPerUnit(measures),
        children: nest(group.cells, rest),
      };
    })
    .sort((a, b) => b.loggedMinutes - a.loggedMinutes || a.label.localeCompare(b.label));
}

export async function getTimeProductivityData(
  params: AnalyticsFilters & { groupBy: GroupDimension },
): Promise<TimeProductivityResult> {
  const [sessions, closed] = await Promise.all([
    /**
     * Time. Fetched as rows rather than grouped in SQL because the estimate
     * has to be counted **once per task**, not once per session — a task
     * worked in three sittings would otherwise triple its own estimate and
     * report a third of its real efficiency.
     */
    prisma.taskTimeLog.findMany({
      where: sessionWhere(params),
      select: {
        durationMinutes: true,
        userId: true,
        user: { select: { name: true } },
        task: {
          select: {
            id: true,
            estimatedMinutes: true,
            practiceId: true,
            practice: { select: { name: true } },
            taskTypeId: true,
            taskType: { select: { name: true } },
          },
        },
      },
    }),
    prisma.task.findMany({
      where: closedTaskWhere(params),
      select: {
        completedById: true,
        completedBy: { select: { name: true } },
        practiceId: true,
        practice: { select: { name: true } },
        taskTypeId: true,
        taskType: { select: { name: true } },
        productivityCount: true,
        productivityAmount: true,
      },
    }),
  ]);

  const cells = new Map<string, Cell>();

  const cellFor = (
    billerId: string,
    billerName: string,
    practiceId: string | null,
    practiceName: string | null,
    taskTypeId: string | null,
    taskTypeName: string | null,
  ): Cell => {
    const key = `${billerId}|${groupKey(practiceId)}|${groupKey(taskTypeId)}`;
    const existing = cells.get(key);

    if (existing) return existing;

    const cell: Cell = {
      billerId,
      billerName,
      practiceId: groupKey(practiceId),
      practiceName: practiceName ?? UNASSIGNED_PRACTICE,
      taskTypeId: groupKey(taskTypeId),
      taskTypeName: taskTypeName ?? UNTYPED,
      ...emptyMeasures(),
    };

    cells.set(key, cell);
    return cell;
  };

  /**
   * Estimates counted once per (task, cell). A task's whole estimate lands in
   * the cell its first session did, which is the only attribution available
   * when two people share one task.
   */
  const estimateCounted = new Set<string>();

  for (const session of sessions) {
    const cell = cellFor(
      session.userId,
      session.user.name,
      session.task.practiceId,
      session.task.practice?.name ?? null,
      session.task.taskTypeId,
      session.task.taskType?.name ?? null,
    );

    addMeasures(cell, {
      loggedMinutes: session.durationMinutes ?? 0,
      sessions: 1,
    });

    const estimateKey = `${session.task.id}|${cell.billerId}|${cell.practiceId}|${cell.taskTypeId}`;

    if (!estimateCounted.has(estimateKey)) {
      estimateCounted.add(estimateKey);
      addMeasures(cell, { estimatedMinutes: session.task.estimatedMinutes ?? 0 });
    }
  }

  for (const task of closed) {
    // A task closed by nobody cannot be attributed; it is counted in the
    // totals through its sessions instead.
    if (!task.completedById) continue;

    const cell = cellFor(
      task.completedById,
      task.completedBy?.name ?? "Unknown",
      task.practiceId,
      task.practice?.name ?? null,
      task.taskTypeId,
      task.taskType?.name ?? null,
    );

    addMeasures(cell, {
      units: task.productivityCount ?? 0,
      closedTasks: 1,
      amount: task.productivityAmount?.toString() ?? null,
    });
  }

  const all = Array.from(cells.values());
  const total = totalMeasures(all);

  return {
    groupBy: HIERARCHY[params.groupBy],
    rows: nest(all, HIERARCHY[params.groupBy]),
    total: {
      ...total,
      efficiencyRate: efficiencyRate(total),
      secondsPerUnit: secondsPerUnit(total),
    },
  };
}
