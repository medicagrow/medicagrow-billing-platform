/**
 * How a task is named on screen.
 *
 * Tasks no longer carry a title: a biller creating twenty "Claim Follow-up"
 * tasks was writing the same string twenty times, so the type and practice
 * identify the work instead. `title` survives on older rows and is used when
 * there is nothing better.
 *
 * Free of Prisma and of React, so server components, client components and
 * scripts can all call it.
 */

export interface TaskLabelSource {
  title?: string | null;
  taskType?: { name: string } | null;
  taskTypeName?: string | null;
  practiceId?: string | null;
  practice?: { name: string } | null;
  practiceName?: string | null;
}

export function getTaskLabel(task: TaskLabelSource): string {
  const type = task.taskType?.name ?? task.taskTypeName ?? null;
  const practice = task.practice?.name ?? task.practiceName ?? null;

  if (type && practice) return `${type} — ${practice}`;
  if (type) return type;
  if (task.title) return task.title;

  return "Untitled Task";
}
