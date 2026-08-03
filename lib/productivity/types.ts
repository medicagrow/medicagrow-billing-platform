/**
 * Cross-module productivity reporting.
 *
 * Each module contributes its own activity summaries through a provider with
 * the same signature, so adding Eligibility or Denial Management later means
 * writing one file and adding it to the array in ./index.ts — no changes to
 * the API routes or pages.
 */

export type ActivityModule =
  | "AR"
  | "ELIGIBILITY"
  | "DENIAL"
  | "ERA_POSTING"
  | "TASK"
  | "TODO";

export const ACTIVITY_MODULE_LABELS: Record<ActivityModule, string> = {
  AR: "AR Follow-Up",
  ELIGIBILITY: "Eligibility",
  DENIAL: "Denial Management",
  ERA_POSTING: "ERA/EOB Posting",
  TASK: "Task Management",
  TODO: "To Do",
};

export interface ActivitySummary {
  module: ActivityModule;
  /** Stable machine key, used as the drill-down `activity` query param. */
  key: string;
  /** "AR Claims Worked", "Eligibility Checks", … */
  label: string;
  count: number;
  /** Total money represented by the activity, as a Decimal-safe string. */
  totalValue?: string;
  drillDownUrl: string;
}

/**
 * Closed work of one type, for one person, in the window.
 *
 * `count` and `totalAmount` are what the person recorded on closing the task;
 * `taskCount` is how many tasks that came from, so a type whose work carries
 * no numbers still shows that it happened.
 */
export interface TaskTypeProductivity {
  taskTypeId: string | null;
  taskTypeName: string;
  count: number;
  taskCount: number;
  /** Decimal-safe string, or null when no task of this type carried an amount. */
  totalAmount: string | null;
  loggedMinutes: number;
}

export interface BillerProductivity {
  userId: string;
  userName: string;
  role: string;
  assignedPractices: string[];
  activities: ActivitySummary[];
  /** Timer time in the window, from `task_time_logs`. */
  totalLoggedMinutes: number;
  /** Closed tasks by type. Only types with a closed task in the window. */
  taskTypeBreakdown: TaskTypeProductivity[];
  dateRange: { from: Date; to: Date };
}

export interface ProductivityQuery {
  userId: string;
  from: Date;
  to: Date;
  /** One practice — the global top-bar selection. Wins over `practiceIds`. */
  practiceId?: string;
  /** Several practices — the report's own filter. */
  practiceIds?: string[];
}

/**
 * The `{ practiceId: … }` fragment for a query's practice selection, or an
 * empty object for "every practice this caller can see". One place, so the
 * single-select and multi-select filters cannot drift apart.
 */
export function practiceFilterFor(query: {
  practiceId?: string;
  practiceIds?: string[];
}): Record<string, unknown> {
  if (query.practiceId) return { practiceId: query.practiceId };

  if (query.practiceIds && query.practiceIds.length > 0) {
    return { practiceId: { in: query.practiceIds } };
  }

  return {};
}

/** Every module's productivity function has this shape. */
export type ProductivityProvider = (
  query: ProductivityQuery,
) => Promise<ActivitySummary[]>;

/** A named slice of a drill-down, e.g. completions per task type. */
export interface ActivityBreakdown {
  label: string;
  count: number;
}

/** One page of drill-down records, whatever their shape. */
export interface ActivityDetailPage<T = unknown> {
  activityKey: string;
  label: string;
  module: ActivityModule;
  rows: T[];
  /** Optional grouping shown above the table. */
  breakdown?: ActivityBreakdown[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** Modules also register how to fetch the records behind an activity. */
export type ActivityDetailProvider = (
  query: ProductivityQuery & {
    activityKey: string;
    skip: number;
    take: number;
  },
) => Promise<ActivityDetailPage | null>;

export function buildDrillDownUrl(
  userId: string,
  activityKey: string,
  from: Date,
  to: Date,
  practiceId?: string,
): string {
  const params = new URLSearchParams({
    activity: activityKey,
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  });

  if (practiceId) params.set("practiceId", practiceId);

  return `/productivity/${userId}/detail?${params.toString()}`;
}

/** Sum of every activity count, used to rank the team table. */
export function totalActivity(activities: ActivitySummary[]): number {
  return activities.reduce((running, activity) => running + activity.count, 0);
}
