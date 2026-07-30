import type { TodoPriority, TodoStatus } from "@/lib/generated/prisma/enums";

export interface TodoDto {
  id: string;
  title: string;
  description: string | null;
  practiceId: string | null;
  practiceName: string | null;
  createdById: string;
  createdByName: string | null;
  assignedToId: string;
  assignedToName: string | null;
  subAssignedToId: string | null;
  subAssignedToName: string | null;
  dueDate: string | null;
  estimatedMinutes: number | null;
  priority: TodoPriority;
  status: TodoStatus;
  holdReleaseDate: string | null;
  isShared: boolean;
  completedAt: string | null;
  isRecurring: boolean;
  parentTodoId: string | null;
  tags: string[];
  noteCount: number;
}

type TodoRow = {
  id: string;
  title: string;
  description: string | null;
  practiceId: string | null;
  createdById: string;
  assignedToId: string;
  subAssignedToId: string | null;
  dueDate: Date | null;
  estimatedMinutes: number | null;
  priority: TodoPriority;
  status: TodoStatus;
  holdReleaseDate: Date | null;
  isShared: boolean;
  completedAt: Date | null;
  isRecurring: boolean;
  parentTodoId: string | null;
  tags: string[];
  practice?: { name: string } | null;
  createdBy?: { name: string } | null;
  assignedTo?: { name: string } | null;
  subAssignedTo?: { name: string } | null;
  _count?: { notes: number } | null;
};

export function toTodoDto(todo: TodoRow): TodoDto {
  return {
    id: todo.id,
    title: todo.title,
    description: todo.description,
    practiceId: todo.practiceId,
    practiceName: todo.practice?.name ?? null,
    createdById: todo.createdById,
    createdByName: todo.createdBy?.name ?? null,
    assignedToId: todo.assignedToId,
    assignedToName: todo.assignedTo?.name ?? null,
    subAssignedToId: todo.subAssignedToId,
    subAssignedToName: todo.subAssignedTo?.name ?? null,
    dueDate: todo.dueDate?.toISOString() ?? null,
    estimatedMinutes: todo.estimatedMinutes,
    priority: todo.priority,
    status: todo.status,
    holdReleaseDate: todo.holdReleaseDate?.toISOString() ?? null,
    isShared: todo.isShared,
    completedAt: todo.completedAt?.toISOString() ?? null,
    isRecurring: todo.isRecurring,
    parentTodoId: todo.parentTodoId,
    tags: todo.tags,
    noteCount: todo._count?.notes ?? 0,
  };
}

export const TODO_INCLUDE = {
  practice: { select: { name: true } },
  createdBy: { select: { name: true } },
  assignedTo: { select: { name: true } },
  subAssignedTo: { select: { name: true } },
  _count: { select: { notes: true } },
} as const;

/** Human-readable status names, shared by every to do surface. */
export const TODO_STATUS_LABELS: Record<TodoStatus, string> = {
  OPEN: "Open",
  IN_PROCESS: "In Process",
  HOLD: "Hold",
  CLOSED: "Closed",
};

/** Highest priority first, used for daily planning order. */
export const PRIORITY_RANK: Record<TodoPriority, number> = {
  URGENT: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};
