/**
 * Task and To Do activity keys and labels.
 *
 * Kept free of Prisma so client components can import them without dragging
 * the database driver into the browser bundle. The queries live in
 * ./work-productivity.ts.
 */

export const WORK_ACTIVITIES = {
  TASKS_COMPLETED: "tasks_completed",
  TODOS_COMPLETED: "todos_completed",
} as const;

export type WorkActivityKey =
  (typeof WORK_ACTIVITIES)[keyof typeof WORK_ACTIVITIES];

export const WORK_ACTIVITY_LABELS: Record<WorkActivityKey, string> = {
  [WORK_ACTIVITIES.TASKS_COMPLETED]: "Tasks Completed",
  [WORK_ACTIVITIES.TODOS_COMPLETED]: "To Dos Completed",
};
