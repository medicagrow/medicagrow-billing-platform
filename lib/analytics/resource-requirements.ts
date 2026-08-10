import { TaskStatus } from "@/lib/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { projectRecurringTasks } from "@/lib/task/workload-projection";
import { UNTYPED } from "@/lib/analytics/shared";

/**
 * What each practice needs this month against what has actually been booked.
 *
 * "Needs" is the number a PM committed to in `PracticeRequirement`, not one
 * derived from history. A requirement that drifted with the last three months'
 * output could not be missed — the target would follow the shortfall down —
 * so the commitment and the measurement are kept apart. History appears too,
 * as the *units* column, to inform the next commitment rather than to be it.
 */

export interface RequirementTaskType {
  taskTypeId: string;
  taskTypeName: string;
  /** From PracticeRequirement, or null where nobody has set one. */
  requiredHours: number | null;
  assignedHours: number;
  projectedHours: number;
  gapHours: number | null;
  /** Average units a month over the last three, or null with no history. */
  unitsPerMonth: number | null;
  /** Average minutes per unit over the same window. */
  minutesPerUnit: number | null;
  notes: string | null;
}

export interface RequirementPractice {
  practiceId: string;
  practiceName: string;
  requiredHours: number;
  assignedHours: number;
  projectedHours: number;
  /** Positive is spare capacity, negative is a shortfall. */
  bufferHours: number;
  status: "adequate" | "tight" | "short" | "unset";
  billerCount: number;
  /** Who is on this practice — ids, so a suggestion can name one exactly. */
  billers: { id: string; name: string }[];
  taskTypes: RequirementTaskType[];
}

export interface RebalancingSuggestion {
  practiceId: string;
  practiceName: string;
  taskTypeName: string;
  shortfallHours: number;
  candidateUserId: string;
  candidateName: string;
  availableHours: number;
  message: string;
}

export interface ResourceRequirementsResult {
  month: number;
  year: number;
  practices: RequirementPractice[];
  summary: {
    understaffed: number;
    adequate: number;
    totalShortfallHours: number;
    billersWithCapacity: number;
  };
  suggestions: RebalancingSuggestion[];
}

/** Under ten per cent short is tight; more than that is short. */
const TIGHT_THRESHOLD = 0.1;

const hoursFrom = (minutes: number) => Math.round((minutes / 60) * 10) / 10;

export async function getResourceRequirementsData(params: {
  month: number;
  year: number;
  practiceIds?: string[];
}): Promise<ResourceRequirementsResult> {
  const monthStart = new Date(Date.UTC(params.year, params.month - 1, 1));
  const monthEnd = new Date(
    Date.UTC(params.year, params.month, 0, 23, 59, 59, 999),
  );

  // Three whole months before this one, for the units average.
  const historyStart = new Date(Date.UTC(params.year, params.month - 4, 1));

  const practiceScope = params.practiceIds?.length
    ? { id: { in: params.practiceIds } }
    : {};

  const [practices, requirements, assigned, history, projected] =
    await Promise.all([
      prisma.practice.findMany({
        where: { isActive: true, ...practiceScope },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          users: { select: { user: { select: { id: true, name: true } } } },
        },
      }),
      prisma.practiceRequirement.findMany({
        where: params.practiceIds?.length
          ? { practiceId: { in: params.practiceIds } }
          : {},
        include: { taskType: { select: { id: true, name: true } } },
      }),
      /** Everything booked into the month, closed or not. */
      prisma.task.findMany({
        where: {
          dueDate: { gte: monthStart, lte: monthEnd },
          isRecurring: false,
          ...(params.practiceIds?.length
            ? { practiceId: { in: params.practiceIds } }
            : {}),
        },
        select: {
          practiceId: true,
          taskTypeId: true,
          estimatedMinutes: true,
        },
      }),
      /** The last three months of finished work, for the units average. */
      prisma.task.findMany({
        where: {
          status: TaskStatus.CLOSED,
          completedAt: { gte: historyStart, lt: monthStart },
          ...(params.practiceIds?.length
            ? { practiceId: { in: params.practiceIds } }
            : {}),
        },
        select: {
          practiceId: true,
          taskTypeId: true,
          productivityCount: true,
          totalLoggedMinutes: true,
        },
      }),
      projectRecurringTasks(monthStart, monthEnd, {
        practiceIds: params.practiceIds,
      }),
    ]);

  /** practiceId → taskTypeId → running totals. */
  const assignedMinutes = new Map<string, Map<string, number>>();
  const projectedMinutes = new Map<string, Map<string, number>>();
  const historyUnits = new Map<string, Map<string, number>>();
  const historyMinutes = new Map<string, Map<string, number>>();

  const bump = (
    into: Map<string, Map<string, number>>,
    practiceId: string | null,
    taskTypeId: string | null,
    amount: number,
  ) => {
    if (!practiceId) return;

    const byType = into.get(practiceId) ?? new Map<string, number>();
    const key = taskTypeId ?? "none";

    byType.set(key, (byType.get(key) ?? 0) + amount);
    into.set(practiceId, byType);
  };

  for (const task of assigned) {
    bump(assignedMinutes, task.practiceId, task.taskTypeId, task.estimatedMinutes ?? 0);
  }

  for (const projection of projected) {
    bump(
      projectedMinutes,
      projection.practiceId,
      projection.taskTypeId,
      projection.estimatedMinutes,
    );
  }

  for (const task of history) {
    bump(historyUnits, task.practiceId, task.taskTypeId, task.productivityCount ?? 0);
    bump(historyMinutes, task.practiceId, task.taskTypeId, task.totalLoggedMinutes);
  }

  const rows: RequirementPractice[] = practices.map((practice) => {
    const own = requirements.filter(
      (requirement) => requirement.practiceId === practice.id,
    );

    const typeIds = new Set<string>([
      ...own.map((requirement) => requirement.taskTypeId),
      ...Array.from(assignedMinutes.get(practice.id)?.keys() ?? []),
      ...Array.from(projectedMinutes.get(practice.id)?.keys() ?? []),
    ]);

    const taskTypes: RequirementTaskType[] = Array.from(typeIds).map((typeId) => {
      const requirement = own.find(
        (entry) => entry.taskTypeId === typeId,
      );

      const assignedHours = hoursFrom(
        assignedMinutes.get(practice.id)?.get(typeId) ?? 0,
      );
      const projectedHours = hoursFrom(
        projectedMinutes.get(practice.id)?.get(typeId) ?? 0,
      );

      const requiredHours = requirement
        ? Number(requirement.monthlyHours)
        : null;

      const units = historyUnits.get(practice.id)?.get(typeId) ?? 0;
      const minutes = historyMinutes.get(practice.id)?.get(typeId) ?? 0;

      return {
        taskTypeId: typeId,
        taskTypeName: requirement?.taskType.name ?? UNTYPED,
        requiredHours,
        assignedHours,
        projectedHours,
        gapHours:
          requiredHours === null
            ? null
            : Math.round((requiredHours - assignedHours - projectedHours) * 10) /
              10,
        // Three months of history, averaged. No history reads as null so the
        // page can say "set manually" rather than showing a confident zero.
        unitsPerMonth: units > 0 ? Math.round(units / 3) : null,
        minutesPerUnit: units > 0 ? Math.round(minutes / units) : null,
        notes: requirement?.notes ?? null,
      };
    });

    // A type nobody named still needs its name; only the requirement rows
    // carry one, so the rest are resolved below.
    const requiredHours = own.reduce(
      (sum, requirement) => sum + Number(requirement.monthlyHours),
      0,
    );

    const assignedHours = taskTypes.reduce(
      (sum, type) => sum + type.assignedHours,
      0,
    );
    const projectedHoursTotal = taskTypes.reduce(
      (sum, type) => sum + type.projectedHours,
      0,
    );

    const bufferHours =
      Math.round((assignedHours + projectedHoursTotal - requiredHours) * 10) / 10;

    const status: RequirementPractice["status"] =
      own.length === 0
        ? "unset"
        : bufferHours >= 0
          ? "adequate"
          : Math.abs(bufferHours) <= requiredHours * TIGHT_THRESHOLD
            ? "tight"
            : "short";

    return {
      practiceId: practice.id,
      practiceName: practice.name,
      requiredHours: Math.round(requiredHours * 10) / 10,
      assignedHours: Math.round(assignedHours * 10) / 10,
      projectedHours: Math.round(projectedHoursTotal * 10) / 10,
      bufferHours,
      status,
      billerCount: practice.users.length,
      billers: practice.users.map((entry) => ({
        id: entry.user.id,
        name: entry.user.name,
      })),
      taskTypes: taskTypes.sort((a, b) =>
        a.taskTypeName.localeCompare(b.taskTypeName),
      ),
    };
  });

  /* --------------------------- name the types --------------------------- */

  const missingNames = rows
    .flatMap((row) => row.taskTypes)
    .filter((type) => type.taskTypeName === UNTYPED && type.taskTypeId !== "none")
    .map((type) => type.taskTypeId);

  if (missingNames.length > 0) {
    const named = await prisma.taskType.findMany({
      where: { id: { in: missingNames } },
      select: { id: true, name: true },
    });

    const byId = new Map(named.map((type) => [type.id, type.name]));

    for (const row of rows) {
      for (const type of row.taskTypes) {
        const name = byId.get(type.taskTypeId);
        if (name) type.taskTypeName = name;
      }
    }
  }

  const suggestions = await buildSuggestions(rows, monthStart, monthEnd);

  return {
    month: params.month,
    year: params.year,
    practices: rows,
    summary: {
      understaffed: rows.filter(
        (row) => row.status === "short" || row.status === "tight",
      ).length,
      adequate: rows.filter((row) => row.status === "adequate").length,
      totalShortfallHours:
        Math.round(
          rows
            .filter((row) => row.bufferHours < 0)
            .reduce((sum, row) => sum + Math.abs(row.bufferHours), 0) * 10,
        ) / 10,
      billersWithCapacity: new Set(
        suggestions.map((suggestion) => suggestion.candidateUserId),
      ).size,
    },
    suggestions,
  };
}

/**
 * Who could take the shortfall.
 *
 * Only people already on the practice are offered: moving work to somebody
 * without access to it is not a suggestion, it is a second problem. Capacity
 * is what is left of a 7.5-hour day across the month's working days.
 */
async function buildSuggestions(
  practices: RequirementPractice[],
  monthStart: Date,
  monthEnd: Date,
): Promise<RebalancingSuggestion[]> {
  const short = practices.filter((practice) => practice.bufferHours < 0);
  if (short.length === 0) return [];

  const { getWorkloadData } = await import("@/lib/analytics/workload");

  const workload = await getWorkloadData({
    from: monthStart,
    to: monthEnd,
    targetHoursPerDay: 7.5,
  });

  const capacityByUser = new Map<string, number>();

  for (const biller of workload.billers) {
    const spare = biller.days
      .filter((day) => !day.isWeekend && day.isFuture)
      .reduce(
        (sum, day) =>
          sum + Math.max(0, workload.targetMinutesPerDay - day.totalMinutes),
        0,
      );

    capacityByUser.set(biller.userId, Math.round((spare / 60) * 10) / 10);
  }

  const suggestions: RebalancingSuggestion[] = [];

  for (const practice of short) {
    // The task type with the largest gap is the one worth naming.
    const worstType = practice.taskTypes
      .filter((type) => (type.gapHours ?? 0) > 0)
      .sort((a, b) => (b.gapHours ?? 0) - (a.gapHours ?? 0))[0];

    // Whoever on this practice has the most room left.
    const candidate = practice.billers
      .map((biller) => ({
        userId: biller.id,
        name: biller.name,
        available: capacityByUser.get(biller.id) ?? 0,
      }))
      .sort((a, b) => b.available - a.available)[0];

    if (!candidate || candidate.available <= 0) continue;

    const shortfall = Math.abs(practice.bufferHours);
    const typeName = worstType?.taskTypeName ?? "work";

    suggestions.push({
      practiceId: practice.practiceId,
      practiceName: practice.practiceName,
      taskTypeName: typeName,
      shortfallHours: shortfall,
      candidateUserId: candidate.userId,
      candidateName: candidate.name,
      availableHours: candidate.available,
      message: `${practice.practiceName} needs ${shortfall}h more${
        worstType ? ` of ${typeName}` : ""
      }. ${candidate.name} has ${candidate.available}h unassigned this month and is already on ${practice.practiceName} — consider assigning ${typeName} to them.`,
    });
  }

  return suggestions;
}
