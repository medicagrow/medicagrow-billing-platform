import { z } from "zod";
import { TaskStatus, TodoPriority } from "@/lib/generated/prisma/enums";
import {
  dateStringSchema,
  nonNegativeDecimalSchema,
} from "@/lib/validations/common";

const optionalText = (max: number) =>
  z
    .union([z.string(), z.null(), z.undefined()])
    .transform((value) => (value ?? "").trim())
    .transform((value) => (value === "" ? undefined : value.slice(0, max)))
    // A transform pipeline hides that undefined is acceptable, so without this
    // Zod treats an absent key as missing rather than "not provided".
    .optional();

export const recurringConfigSchema = z.object({
  frequency: z.enum(["daily", "weekly", "biweekly", "monthly"]),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  /** Capped at 28 so every month has the day. */
  dayOfMonth: z.number().int().min(1).max(28).optional(),
  nextDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

/** Weekly and bi-weekly are meaningless without at least one weekday. */
const requiresDays = (config: z.infer<typeof recurringConfigSchema>) =>
  (config.frequency !== "weekly" && config.frequency !== "biweekly") ||
  (config.daysOfWeek !== undefined && config.daysOfWeek.length > 0);

export const createTaskSchema = z
  .object({
    // Tasks are identified by their type and practice, not a typed-in title.
    description: optionalText(4000),
    practiceId: optionalText(40),
    taskTypeId: z.string().min(1, "Please select a task type"),
    assignedToId: z.string().min(1, "Assignee is required"),
    dueDate: dateStringSchema.optional(),
    estimatedMinutes: z.coerce.number().int().min(0).max(1440).optional(),
    priority: z.enum(TodoPriority).default(TodoPriority.MEDIUM),
    status: z.enum(TaskStatus).default(TaskStatus.OPEN),
    holdReleaseDate: dateStringSchema.optional(),
    isVisibleToCreator: z.boolean().default(true),
    isRecurring: z.boolean().default(false),
    recurringConfig: recurringConfigSchema.optional(),
    tags: z.array(z.string().trim().max(40)).max(10).default([]),
  })
  .refine(
    (data) =>
      data.status !== TaskStatus.HOLD || data.holdReleaseDate !== undefined,
    {
      message: "A task on hold needs a release date.",
      path: ["holdReleaseDate"],
    },
  )
  .refine((data) => !data.isRecurring || data.recurringConfig !== undefined, {
    message: "A recurring task needs a recurrence pattern.",
    path: ["recurringConfig"],
  })
  .refine(
    (data) => !data.recurringConfig || requiresDays(data.recurringConfig),
    {
      message: "Choose at least one day of the week.",
      path: ["recurringConfig", "daysOfWeek"],
    },
  );

export const updateTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: optionalText(4000),
    practiceId: optionalText(40),
    taskTypeId: optionalText(40),
    assignedToId: z.string().min(1).optional(),
    dueDate: dateStringSchema.nullable().optional(),
    estimatedMinutes: z.coerce
      .number()
      .int()
      .min(0)
      .max(1440)
      .nullable()
      .optional(),
    /**
     * `actualMinutes` is deliberately absent: it is derived from the timer
     * logs when the task closes, never sent by the client. A number typed into
     * a box is a guess, and it was being compared against the estimate as if
     * it were measured.
     */
    priority: z.enum(TodoPriority).optional(),
    status: z.enum(TaskStatus).optional(),
    holdReleaseDate: dateStringSchema.nullable().optional(),
    isVisibleToCreator: z.boolean().optional(),
    /** Units of work completed, captured when the task is closed. */
    productivityCount: z.coerce
      .number()
      .int()
      .min(0)
      .max(1000000)
      .nullable()
      .optional(),
    productivityAmount: nonNegativeDecimalSchema.nullable().optional(),
    isRecurring: z.boolean().optional(),
    recurringConfig: recurringConfigSchema.nullable().optional(),
    tags: z.array(z.string().trim().max(40)).max(10).optional(),
    /** Optional narration for the status change; always logged as a note. */
    note: optionalText(4000),
  })
  .refine(
    (data) =>
      data.status !== TaskStatus.HOLD ||
      (data.holdReleaseDate !== undefined && data.holdReleaseDate !== null),
    {
      message: "Putting a task on hold requires a release date.",
      path: ["holdReleaseDate"],
    },
  )
  .refine(
    (data) => !data.recurringConfig || requiresDays(data.recurringConfig),
    {
      message: "Choose at least one day of the week.",
      path: ["recurringConfig", "daysOfWeek"],
    },
  );

export const listTasksQuerySchema = z.object({
  assignedToId: z.string().optional(),
  createdById: z.string().optional(),
  status: z.enum(TaskStatus).optional(),
  priority: z.enum(TodoPriority).optional(),
  practiceId: z.string().optional(),
  taskTypeId: z.string().optional(),
  /** Substring match on the title, kept for older titled tasks. */
  search: z.string().optional(),
  tag: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  overdue: z.enum(["true", "false"]).optional(),
  /** "true" narrows to recurring parents and their instances. */
  recurringOnly: z.enum(["true", "false"]).optional(),
  sort: z
    .enum(["dueDate", "priority", "title", "status", "createdAt"])
    .optional(),
  direction: z.enum(["asc", "desc"]).optional(),
});

export const addTaskNoteSchema = z.object({
  note: z.string().trim().min(1, "A note is required").max(4000),
});
