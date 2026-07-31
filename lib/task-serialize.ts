import type { TaskStatus, TodoPriority } from "@/lib/generated/prisma/enums";
import {
  parseRecurringConfig,
  type RecurringConfig,
} from "@/lib/task/recurrence-config";
import { getTaskLabel } from "@/lib/task/task-label";

export interface TaskNoteDto {
  id: string;
  note: string;
  statusChangedTo: TaskStatus | null;
  addedById: string;
  addedByName: string | null;
  addedAt: string;
}

export interface TaskDto {
  id: string;
  /** Legacy; prefer getTaskLabel() from lib/task/task-label.ts. */
  title: string | null;
  /** Type and practice, or the old title — what the row is called on screen. */
  label: string;
  description: string | null;
  practiceId: string | null;
  practiceName: string | null;
  taskTypeId: string | null;
  taskTypeName: string | null;
  createdById: string;
  createdByName: string | null;
  assignedToId: string;
  assignedToName: string | null;
  dueDate: string | null;
  estimatedMinutes: number | null;
  actualMinutes: number | null;

  totalLoggedMinutes: number;
  activeTimerStartedAt: string | null;
  activeTimerUserId: string | null;
  activeTimerUserName: string | null;

  productivityCount: number | null;
  /** Decimal, as a string end to end. */
  productivityAmount: string | null;
  priority: TodoPriority;
  status: TaskStatus;
  holdReleaseDate: string | null;
  completedAt: string | null;
  completedByName: string | null;
  isVisibleToCreator: boolean;

  isRecurring: boolean;
  recurringConfig: RecurringConfig | null;
  parentTaskId: string | null;
  parentTaskTitle: string | null;
  instanceNumber: number | null;
  /** Children generated so far — only populated on a parent. */
  instanceCount: number;

  tags: string[];
  noteCount: number;
  notes?: TaskNoteDto[];
}

type TaskNoteRow = {
  id: string;
  note: string;
  statusChangedTo: TaskStatus | null;
  addedById: string;
  addedAt: Date;
  addedBy?: { name: string } | null;
};

type TaskRow = {
  id: string;
  title: string | null;
  description: string | null;
  practiceId: string | null;
  taskTypeId: string | null;
  createdById: string;
  assignedToId: string;
  dueDate: Date | null;
  estimatedMinutes: number | null;
  actualMinutes: number | null;
  totalLoggedMinutes?: number;
  activeTimerStartedAt?: Date | null;
  activeTimerUserId?: string | null;
  productivityCount?: number | null;
  productivityAmount?: unknown;
  priority: TodoPriority;
  status: TaskStatus;
  holdReleaseDate: Date | null;
  completedAt: Date | null;
  isVisibleToCreator: boolean;
  isRecurring: boolean;
  recurringConfig: unknown;
  parentTaskId: string | null;
  instanceNumber: number | null;
  tags: string[];
  practice?: { name: string } | null;
  taskType?: { name: string } | null;
  createdBy?: { name: string } | null;
  assignedTo?: { name: string } | null;
  completedBy?: { name: string } | null;
  activeTimerUser?: { name: string } | null;
  parentTask?: { title: string | null; taskType?: { name: string } | null } | null;
  notes?: TaskNoteRow[];
  _count?: { notes: number; instances?: number } | null;
};

export function toTaskNoteDto(note: TaskNoteRow): TaskNoteDto {
  return {
    id: note.id,
    note: note.note,
    statusChangedTo: note.statusChangedTo,
    addedById: note.addedById,
    addedByName: note.addedBy?.name ?? null,
    addedAt: note.addedAt.toISOString(),
  };
}

export function toTaskDto(task: TaskRow): TaskDto {
  return {
    id: task.id,
    title: task.title,
    label: getTaskLabel({
      title: task.title,
      taskTypeName: task.taskType?.name ?? null,
      practiceName: task.practice?.name ?? null,
    }),
    description: task.description,
    practiceId: task.practiceId,
    practiceName: task.practice?.name ?? null,
    taskTypeId: task.taskTypeId,
    taskTypeName: task.taskType?.name ?? null,
    createdById: task.createdById,
    createdByName: task.createdBy?.name ?? null,
    assignedToId: task.assignedToId,
    assignedToName: task.assignedTo?.name ?? null,
    dueDate: task.dueDate?.toISOString() ?? null,
    estimatedMinutes: task.estimatedMinutes,
    actualMinutes: task.actualMinutes,
    totalLoggedMinutes: task.totalLoggedMinutes ?? 0,
    activeTimerStartedAt: task.activeTimerStartedAt?.toISOString() ?? null,
    activeTimerUserId: task.activeTimerUserId ?? null,
    activeTimerUserName: task.activeTimerUser?.name ?? null,
    productivityCount: task.productivityCount ?? null,
    productivityAmount:
      task.productivityAmount === null || task.productivityAmount === undefined
        ? null
        : String(task.productivityAmount),
    priority: task.priority,
    status: task.status,
    holdReleaseDate: task.holdReleaseDate?.toISOString() ?? null,
    completedAt: task.completedAt?.toISOString() ?? null,
    completedByName: task.completedBy?.name ?? null,
    isVisibleToCreator: task.isVisibleToCreator,
    isRecurring: task.isRecurring,
    recurringConfig: parseRecurringConfig(task.recurringConfig),
    parentTaskId: task.parentTaskId,
    parentTaskTitle: task.parentTask
      ? getTaskLabel({
          title: task.parentTask.title,
          taskTypeName: task.parentTask.taskType?.name ?? null,
        })
      : null,
    instanceNumber: task.instanceNumber,
    instanceCount: task._count?.instances ?? 0,
    tags: task.tags,
    noteCount: task._count?.notes ?? task.notes?.length ?? 0,
    ...(task.notes ? { notes: task.notes.map(toTaskNoteDto) } : {}),
  };
}

export const TASK_INCLUDE = {
  practice: { select: { name: true } },
  taskType: { select: { name: true } },
  createdBy: { select: { name: true } },
  assignedTo: { select: { name: true } },
  completedBy: { select: { name: true } },
  activeTimerUser: { select: { name: true } },
  parentTask: { select: { title: true, taskType: { select: { name: true } } } },
  _count: { select: { notes: true, instances: true } },
} as const;

/** Detail view — the note log comes with the task. */
export const TASK_DETAIL_INCLUDE = {
  ...TASK_INCLUDE,
  notes: {
    orderBy: { addedAt: "desc" },
    include: { addedBy: { select: { name: true } } },
  },
} as const;
