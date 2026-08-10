import { centsToDecimalString, toCents } from "@/lib/money";

/**
 * Vocabulary the analytics reports share.
 *
 * Every one of them answers "how long did this take and what came out of it",
 * so the definitions of *time*, *units* and *efficiency* have to be written
 * once. Two reports disagreeing about efficiency is worse than neither
 * reporting it.
 */

export interface AnalyticsWindow {
  from: Date;
  to: Date;
}

export interface AnalyticsFilters extends AnalyticsWindow {
  billerIds?: string[];
  practiceIds?: string[];
  taskTypeIds?: string[];
}

/** The figures every level of every hierarchy carries. */
export interface Measures {
  /** Timer minutes in the window, from `task_time_logs`. */
  loggedMinutes: number;
  /** Estimated minutes on the distinct tasks those sessions touched. */
  estimatedMinutes: number;
  /** Units of work recorded on close — charges posted, claims followed up. */
  units: number;
  /** Money those units represent, Decimal-safe. Null when none carried one. */
  amount: string | null;
  /** Tasks closed in the window. */
  closedTasks: number;
  /** Timer sessions in the window. */
  sessions: number;
}

export const emptyMeasures = (): Measures => ({
  loggedMinutes: 0,
  estimatedMinutes: 0,
  units: 0,
  amount: null,
  closedTasks: 0,
  sessions: 0,
});

/**
 * Logged ÷ estimated as a percentage, so **lower is better**.
 *
 * Null when there is no estimate to divide by: a task nobody estimated is an
 * unanswerable question, not a 0% or an infinity. The same rule the tracker
 * uses for a missing measure.
 */
export function efficiencyRate(measures: Measures): number | null {
  if (measures.estimatedMinutes <= 0) return null;

  return (
    Math.round((measures.loggedMinutes / measures.estimatedMinutes) * 1000) / 10
  );
}

/** Seconds per unit, or null when nothing was counted. */
export function secondsPerUnit(measures: Measures): number | null {
  if (measures.units <= 0) return null;

  return Math.round((measures.loggedMinutes * 60) / measures.units);
}

/** "4m 12s" — the shape an average time-per-unit is read in. */
export function formatDuration(seconds: number | null): string {
  if (seconds === null) return "—";

  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;

  if (minutes === 0) return `${rest}s`;

  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
}

/** Accumulates one row's contribution into a running total. */
export function addMeasures(into: Measures, from: Partial<Measures>): void {
  into.loggedMinutes += from.loggedMinutes ?? 0;
  into.estimatedMinutes += from.estimatedMinutes ?? 0;
  into.units += from.units ?? 0;
  into.closedTasks += from.closedTasks ?? 0;
  into.sessions += from.sessions ?? 0;

  if (from.amount !== null && from.amount !== undefined) {
    into.amount = centsToDecimalString(
      toCents(into.amount ?? "0") + toCents(from.amount),
    );
  }
}

/** Sums a list of measures into one. */
export function totalMeasures(rows: Measures[]): Measures {
  const total = emptyMeasures();
  for (const row of rows) addMeasures(total, row);
  return total;
}

/**
 * Sessions are selected by **`startedAt`** and must have stopped.
 *
 * Every report in this directory uses this, so a past period's numbers never
 * change and the hours on one page are the hours on another. A running timer
 * has no duration yet and would read as zero.
 */
export function sessionWhere(filters: AnalyticsFilters) {
  return {
    startedAt: { gte: filters.from, lte: filters.to },
    stoppedAt: { not: null },
    ...(filters.billerIds?.length ? { userId: { in: filters.billerIds } } : {}),
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

/** Closed tasks in the window, attributed to whoever closed them. */
export function closedTaskWhere(filters: AnalyticsFilters) {
  return {
    completedAt: { gte: filters.from, lte: filters.to },
    status: "CLOSED" as const,
    ...(filters.billerIds?.length
      ? { completedById: { in: filters.billerIds } }
      : {}),
    ...(filters.practiceIds?.length
      ? { practiceId: { in: filters.practiceIds } }
      : {}),
    ...(filters.taskTypeIds?.length
      ? { taskTypeId: { in: filters.taskTypeIds } }
      : {}),
  };
}

/** "No practice" and "No type" rather than a blank cell. */
export const UNASSIGNED_PRACTICE = "No practice";
export const UNTYPED = "No type";

/** A map key that tolerates the null side of an optional relation. */
export const groupKey = (value: string | null) => value ?? "none";
