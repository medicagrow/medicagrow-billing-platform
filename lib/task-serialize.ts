import type { TaskStatus, TodoPriority } from "@/lib/generated/prisma/enums";
import {
  parseRecurringConfig,
  type RecurringConfig,
} from "@/lib/task/recurrence-config";

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
  title: string;
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
  title: string;
  description: string | null;
  practiceId: string | null;
  taskTypeId: string | null;
  createdById: string;
  assignedToId: string;
  dueDate: Date | null;
  estimatedMinutes: number | null;
  actualMinutes: number | null;
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
  parentTask?: { title: string } | null;
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
    priority: task.priority,
    status: task.status,
    holdReleaseDate: task.holdReleaseDate?.toISOString() ?? null,
    completedAt: task.completedAt?.toISOString() ?? null,
    completedByName: task.completedBy?.name ?? null,
    isVisibleToCreator: task.isVisibleToCreator,
    isRecurring: task.isRecurring,
    recurringConfig: parseRecurringConfig(task.recurringConfig),
    parentTaskId: task.parentTaskId,
    parentTaskTitle: task.parentTask?.title ?? null,
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
  parentTask: { select: { title: true } },
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
