import { TaskStatus } from "@/lib/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { getTaskLabel } from "@/lib/task/task-label";
import { UNTYPED, type AnalyticsFilters } from "@/lib/analytics/shared";

/**
 * Timer behaviour that does not add up.
 *
 * Every one of these is a **question, not an accusation**. A two-minute
 * session on an hour-long task is usually somebody starting the timer to check
 * something and stopping again; occasionally it is somebody clocking work they
 * did not do. The report cannot tell the difference and does not try — it
 * surfaces the pattern and leaves the judgement to a person, which is why
 * every flag can be dismissed and why the dismissal is recorded with a name.
 *
 * Flags are derived on every request rather than stored, so a threshold change
 * re-reads history correctly instead of leaving old rows behind.
 */

export const FLAG_TYPES = [
  "SHORT_TIMER",
  "EXTREME_OVERRUN",
  "NO_PRODUCTIVITY",
  "PATTERN",
] as const;

export type SuspiciousFlag = (typeof FLAG_TYPES)[number];

export const FLAG_LABELS: Record<SuspiciousFlag, string> = {
  SHORT_TIMER: "Short timer",
  EXTREME_OVERRUN: "Extreme overrun",
  NO_PRODUCTIVITY: "Closed without count",
  PATTERN: "Repeated pattern",
};

/**
 * The thresholds, in one place so the page and the report agree and so
 * changing one is a single edit.
 *
 *  - A session under five minutes against an estimate of half an hour or more
 *    is too short to have been the work.
 *  - Three times the estimate is past "it took longer" and into "something
 *    else happened".
 *  - Three occurrences of the same flag for the same person and kind of work
 *    stops being an accident.
 */
export const THRESHOLDS = {
  shortTimerMaxMinutes: 5,
  shortTimerMinEstimate: 30,
  overrunMultiple: 3,
  patternOccurrences: 3,
} as const;

export interface FlaggedSession {
  /** Stable across recomputation, so a dismissal sticks to the same finding. */
  flagKey: string;
  flagType: SuspiciousFlag;
  timeLogId: string | null;
  taskId: string;
  taskLabel: string;
  practiceId: string | null;
  practiceName: string | null;
  taskTypeId: string | null;
  taskTypeName: string;
  billerId: string;
  billerName: string;
  occurredAt: string;
  estimatedMinutes: number | null;
  loggedMinutes: number;
  productivityCount: number | null;
  dismissed: boolean;
  dismissedByName: string | null;
}

export interface DetectedPattern {
  flagKey: string;
  billerId: string;
  billerName: string;
  taskTypeId: string | null;
  taskTypeName: string;
  flagType: SuspiciousFlag;
  occurrences: number;
  dates: string[];
  severity: "amber" | "red";
  dismissed: boolean;
}

export interface SuspiciousActivityResult {
  sessions: FlaggedSession[];
  patterns: DetectedPattern[];
  summary: Record<SuspiciousFlag, number>;
}

/** Five or more of the same thing is worse than three. */
const SEVERE_OCCURRENCES = 5;

export async function getSuspiciousActivity(
  params: AnalyticsFilters & { flagTypes?: SuspiciousFlag[] },
): Promise<SuspiciousActivityResult> {
  const wanted = (flag: SuspiciousFlag) =>
    !params.flagTypes?.length || params.flagTypes.includes(flag);

  const taskScope = {
    ...(params.practiceIds?.length
      ? { practiceId: { in: params.practiceIds } }
      : {}),
    ...(params.taskTypeIds?.length
      ? { taskTypeId: { in: params.taskTypeIds } }
      : {}),
  };

  const [shortTimers, overruns, noCounts, dismissals] = await Promise.all([
    /** A session too brief to have been the work it is logged against. */
    prisma.taskTimeLog.findMany({
      where: {
        startedAt: { gte: params.from, lte: params.to },
        stoppedAt: { not: null },
        durationMinutes: { lt: THRESHOLDS.shortTimerMaxMinutes },
        ...(params.billerIds?.length ? { userId: { in: params.billerIds } } : {}),
        task: {
          estimatedMinutes: { gte: THRESHOLDS.shortTimerMinEstimate },
          ...taskScope,
        },
      },
      select: {
        id: true,
        startedAt: true,
        durationMinutes: true,
        userId: true,
        user: { select: { name: true } },
        task: {
          select: {
            id: true,
            title: true,
            estimatedMinutes: true,
            productivityCount: true,
            practiceId: true,
            practice: { select: { name: true } },
            taskTypeId: true,
            taskType: { select: { name: true } },
          },
        },
      },
    }),
    /**
     * Logged time far past the estimate. Read from the task rather than the
     * sessions: the overrun belongs to the task as a whole, and flagging each
     * session separately would report one problem five times.
     */
    prisma.task.findMany({
      where: {
        estimatedMinutes: { gt: 0 },
        completedAt: { gte: params.from, lte: params.to },
        ...(params.billerIds?.length
          ? { completedById: { in: params.billerIds } }
          : {}),
        ...taskScope,
      },
      select: {
        id: true,
        title: true,
        estimatedMinutes: true,
        totalLoggedMinutes: true,
        productivityCount: true,
        completedAt: true,
        completedById: true,
        completedBy: { select: { name: true } },
        practiceId: true,
        practice: { select: { name: true } },
        taskTypeId: true,
        taskType: { select: { name: true } },
      },
    }),
    /** Closed, timed, and nothing to show for it. */
    prisma.task.findMany({
      where: {
        status: TaskStatus.CLOSED,
        completedAt: { gte: params.from, lte: params.to },
        OR: [{ productivityCount: null }, { productivityCount: 0 }],
        timeLogs: { some: {} },
        ...(params.billerIds?.length
          ? { completedById: { in: params.billerIds } }
          : {}),
        ...taskScope,
      },
      select: {
        id: true,
        title: true,
        estimatedMinutes: true,
        totalLoggedMinutes: true,
        productivityCount: true,
        completedAt: true,
        completedById: true,
        completedBy: { select: { name: true } },
        practiceId: true,
        practice: { select: { name: true } },
        taskTypeId: true,
        taskType: { select: { name: true } },
      },
    }),
    prisma.analyticsFlagDismissal.findMany({
      include: { dismissedBy: { select: { name: true } } },
    }),
  ]);

  const dismissedBy = new Map(
    dismissals.map((entry) => [entry.flagKey, entry.dismissedBy.name]),
  );

  const sessions: FlaggedSession[] = [];

  if (wanted("SHORT_TIMER")) {
    for (const log of shortTimers) {
      const flagKey = `SHORT_TIMER:${log.id}`;

      sessions.push({
        flagKey,
        flagType: "SHORT_TIMER",
        timeLogId: log.id,
        taskId: log.task.id,
        taskLabel: getTaskLabel(log.task),
        practiceId: log.task.practiceId,
        practiceName: log.task.practice?.name ?? null,
        taskTypeId: log.task.taskTypeId,
        taskTypeName: log.task.taskType?.name ?? UNTYPED,
        billerId: log.userId,
        billerName: log.user.name,
        occurredAt: log.startedAt.toISOString(),
        estimatedMinutes: log.task.estimatedMinutes,
        loggedMinutes: log.durationMinutes ?? 0,
        productivityCount: log.task.productivityCount,
        dismissed: dismissedBy.has(flagKey),
        dismissedByName: dismissedBy.get(flagKey) ?? null,
      });
    }
  }

  if (wanted("EXTREME_OVERRUN")) {
    for (const task of overruns) {
      const estimate = task.estimatedMinutes ?? 0;

      if (task.totalLoggedMinutes < estimate * THRESHOLDS.overrunMultiple) {
        continue;
      }

      const flagKey = `EXTREME_OVERRUN:${task.id}`;

      sessions.push({
        flagKey,
        flagType: "EXTREME_OVERRUN",
        timeLogId: null,
        taskId: task.id,
        taskLabel: getTaskLabel(task),
        practiceId: task.practiceId,
        practiceName: task.practice?.name ?? null,
        taskTypeId: task.taskTypeId,
        taskTypeName: task.taskType?.name ?? UNTYPED,
        billerId: task.completedById ?? "",
        billerName: task.completedBy?.name ?? "Unknown",
        occurredAt: (task.completedAt ?? params.to).toISOString(),
        estimatedMinutes: task.estimatedMinutes,
        loggedMinutes: task.totalLoggedMinutes,
        productivityCount: task.productivityCount,
        dismissed: dismissedBy.has(flagKey),
        dismissedByName: dismissedBy.get(flagKey) ?? null,
      });
    }
  }

  if (wanted("NO_PRODUCTIVITY")) {
    for (const task of noCounts) {
      const flagKey = `NO_PRODUCTIVITY:${task.id}`;

      sessions.push({
        flagKey,
        flagType: "NO_PRODUCTIVITY",
        timeLogId: null,
        taskId: task.id,
        taskLabel: getTaskLabel(task),
        practiceId: task.practiceId,
        practiceName: task.practice?.name ?? null,
        taskTypeId: task.taskTypeId,
        taskTypeName: task.taskType?.name ?? UNTYPED,
        billerId: task.completedById ?? "",
        billerName: task.completedBy?.name ?? "Unknown",
        occurredAt: (task.completedAt ?? params.to).toISOString(),
        estimatedMinutes: task.estimatedMinutes,
        loggedMinutes: task.totalLoggedMinutes,
        productivityCount: task.productivityCount,
        dismissed: dismissedBy.has(flagKey),
        dismissedByName: dismissedBy.get(flagKey) ?? null,
      });
    }
  }

  /* ------------------------------ patterns ------------------------------ */

  /**
   * A pattern is the same flag, the same person, the same kind of work,
   * repeatedly. One short timer is noise; three on charge posting in a
   * fortnight is a habit worth asking about.
   *
   * Only SHORT_TIMER and NO_PRODUCTIVITY roll up: an overrun repeating usually
   * means the estimate is wrong, which is a planning problem rather than a
   * conduct one.
   */
  const patterns: DetectedPattern[] = [];

  if (wanted("PATTERN")) {
    const buckets = new Map<
      string,
      {
        billerId: string;
        billerName: string;
        taskTypeId: string | null;
        taskTypeName: string;
        flagType: SuspiciousFlag;
        dates: string[];
      }
    >();

    for (const flagged of sessions) {
      if (
        flagged.flagType !== "SHORT_TIMER" &&
        flagged.flagType !== "NO_PRODUCTIVITY"
      ) {
        continue;
      }

      const key = `${flagged.flagType}:${flagged.billerId}:${flagged.taskTypeId ?? "none"}`;
      const bucket = buckets.get(key) ?? {
        billerId: flagged.billerId,
        billerName: flagged.billerName,
        taskTypeId: flagged.taskTypeId,
        taskTypeName: flagged.taskTypeName,
        flagType: flagged.flagType,
        dates: [] as string[],
      };

      bucket.dates.push(flagged.occurredAt.slice(0, 10));
      buckets.set(key, bucket);
    }

    for (const [key, bucket] of buckets) {
      if (bucket.dates.length < THRESHOLDS.patternOccurrences) continue;

      const flagKey = `PATTERN:${key}`;

      patterns.push({
        flagKey,
        billerId: bucket.billerId,
        billerName: bucket.billerName,
        taskTypeId: bucket.taskTypeId,
        taskTypeName: bucket.taskTypeName,
        flagType: bucket.flagType,
        occurrences: bucket.dates.length,
        dates: Array.from(new Set(bucket.dates)).sort(),
        severity:
          bucket.dates.length >= SEVERE_OCCURRENCES ? "red" : "amber",
        dismissed: dismissedBy.has(flagKey),
      });
    }
  }

  sessions.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  patterns.sort((a, b) => b.occurrences - a.occurrences);

  const summary: Record<SuspiciousFlag, number> = {
    SHORT_TIMER: 0,
    EXTREME_OVERRUN: 0,
    NO_PRODUCTIVITY: 0,
    PATTERN: patterns.filter((pattern) => !pattern.dismissed).length,
  };

  for (const flagged of sessions) {
    if (!flagged.dismissed) summary[flagged.flagType] += 1;
  }

  return { sessions, patterns, summary };
}

/**
 * The flag keys for a set of sessions, so the session log can mark rows
 * without recomputing every threshold a second way.
 */
export async function flaggedTimeLogIds(
  params: AnalyticsFilters,
): Promise<Map<string, SuspiciousFlag>> {
  const result = await getSuspiciousActivity(params);
  const byLogId = new Map<string, SuspiciousFlag>();

  for (const flagged of result.sessions) {
    if (flagged.timeLogId) byLogId.set(flagged.timeLogId, flagged.flagType);
  }

  return byLogId;
}
