/**
 * The vocabulary of the suspicious-activity report: the flag types, their
 * labels, the thresholds behind them and the shapes they are reported in.
 *
 * **Free of Prisma**, so the pages can import it. `suspicious-activity.ts`
 * holds the queries and re-exports everything here, exactly as
 * `ar-activities.ts` does for the AR report — importing that module from a
 * client component pulls `pg` into the browser bundle and fails the build.
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

/** Five or more of the same thing is worse than three. */
export const SEVERE_OCCURRENCES = 5;

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
