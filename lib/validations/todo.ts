import { z } from "zod";
import { TimeBlockType, TodoPriority, TodoStatus } from "@/lib/generated/prisma/enums";
import { dateStringSchema } from "@/lib/validations/common";

const optionalText = (max: number) =>
  z
    .union([z.string(), z.null(), z.undefined()])
    .transform((value) => (value ?? "").trim())
    .transform((value) => (value === "" ? undefined : value.slice(0, max)))
    // A transform pipeline hides that undefined is acceptable, so without this
    // Zod treats an absent key as missing rather than "not provided".
    .optional();

export const recurringConfigSchema = z.object({
  frequency: z.enum(["daily", "weekly", "monthly"]),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
  dayOfMonth: z.number().int().min(1).max(31).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const createTodoSchema = z
  .object({
    title: z.string().trim().min(1, "A title is required").max(200),
    description: optionalText(4000),
    practiceId: optionalText(40),
    assignedToId: z.string().min(1, "Assignee is required"),
    subAssignedToId: optionalText(40),
    dueDate: dateStringSchema.optional(),
    estimatedMinutes: z.coerce.number().int().min(0).max(1440).optional(),
    priority: z.enum(TodoPriority).default(TodoPriority.MEDIUM),
    tags: z.array(z.string().trim().max(40)).max(10).default([]),
    isRecurring: z.boolean().default(false),
    recurringConfig: recurringConfigSchema.optional(),
    /** Keeps the todo in the creator's own list after assigning it out. */
    isShared: z.boolean().default(false),
  })
  .refine(
    (data) => !data.isRecurring || data.recurringConfig !== undefined,
    { message: "A recurring task needs a recurrence pattern.", path: ["recurringConfig"] },
  )
  .refine(
    (data) => !data.isRecurring || data.dueDate !== undefined,
    { message: "A recurring task needs a start date.", path: ["dueDate"] },
  );

export const updateTodoSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: optionalText(4000),
    practiceId: optionalText(40),
    assignedToId: z.string().min(1).optional(),
    /** Empty string clears the delegation. */
    subAssignedToId: z
      .union([z.string(), z.null(), z.undefined()])
      .transform((value) => (value ?? "").trim() || null)
      .optional(),
    dueDate: dateStringSchema.nullable().optional(),
    estimatedMinutes: z.coerce.number().int().min(0).max(1440).nullable().optional(),
    priority: z.enum(TodoPriority).optional(),
    status: z.enum(TodoStatus).optional(),
    holdReleaseDate: dateStringSchema.nullable().optional(),
    isShared: z.boolean().optional(),
    tags: z.array(z.string().trim().max(40)).max(10).optional(),
    /** Optional narration for the status change; logged as a note. */
    note: optionalText(4000),
    /** Kept for the older defer flow, which wrote its reason here. */
    deferNote: optionalText(500),
  })
  .refine(
    (data) =>
      data.status !== TodoStatus.HOLD ||
      (data.holdReleaseDate !== undefined && data.holdReleaseDate !== null),
    {
      message: "Putting a to do on hold requires a release date.",
      path: ["holdReleaseDate"],
    },
  );

export const listTodosQuerySchema = z.object({
  assignedToId: z.string().optional(),
  subAssignedToId: z.string().optional(),
  status: z.enum(TodoStatus).optional(),
  priority: z.enum(TodoPriority).optional(),
  practiceId: z.string().optional(),
  search: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  overdue: z.enum(["true", "false"]).optional(),
  isRecurring: z.enum(["true", "false"]).optional(),
  isShared: z.enum(["true", "false"]).optional(),
  sort: z
    .enum(["dueDate", "priority", "title", "status", "assignedTo"])
    .optional(),
  direction: z.enum(["asc", "desc"]).optional(),
});

export const addTodoNoteSchema = z.object({
  note: z.string().trim().min(1, "A note is required").max(4000),
});

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

export const timeBlockSchema = z
  .object({
    dayOfWeek: z.coerce.number().int().min(0).max(6).nullable().optional(),
    specificDate: dateStringSchema.nullable().optional(),
    startTime: z.string().regex(timePattern, "Use HH:MM, 24-hour"),
    endTime: z.string().regex(timePattern, "Use HH:MM, 24-hour"),
    label: z.string().trim().min(1, "A label is required").max(80),
    blockType: z.enum(TimeBlockType).default(TimeBlockType.TODO_WORK),
    color: optionalText(20),
    isActive: z.boolean().default(true),
    /** Set to replace a weekly-template block on one date only. */
    overridesBlockId: optionalText(40),
    /** A hidden override removes the template block from that date. */
    isHidden: z.boolean().default(false),
  })
  .refine((data) => data.startTime < data.endTime, {
    message: "End time must be after start time.",
    path: ["endTime"],
  })
  .refine(
    (data) =>
      (data.dayOfWeek !== null && data.dayOfWeek !== undefined) ||
      (data.specificDate !== null && data.specificDate !== undefined),
    {
      message: "Choose a weekday or a specific date.",
      path: ["dayOfWeek"],
    },
  );

/** Suppressing or replacing a template block for a single date. */
export const timeBlockOverrideSchema = z
  .object({
    blockId: z.string().min(1, "A block is required"),
    date: dateStringSchema,
    /** Omit every time field to hide the block for that date. */
    startTime: z.string().regex(timePattern).optional(),
    endTime: z.string().regex(timePattern).optional(),
    label: z.string().trim().min(1).max(80).optional(),
    blockType: z.enum(TimeBlockType).optional(),
    hide: z.boolean().default(false),
  })
  .refine(
    (data) =>
      data.hide ||
      (data.startTime !== undefined && data.endTime !== undefined),
    {
      message: "An override needs a start and end time.",
      path: ["startTime"],
    },
  )
  .refine(
    (data) =>
      data.hide ||
      data.startTime === undefined ||
      data.endTime === undefined ||
      data.startTime < data.endTime,
    { message: "End time must be after start time.", path: ["endTime"] },
  );

export const updateTimeBlockSchema = z.object({
  dayOfWeek: z.coerce.number().int().min(0).max(6).nullable().optional(),
  specificDate: dateStringSchema.nullable().optional(),
  startTime: z.string().regex(timePattern).optional(),
  endTime: z.string().regex(timePattern).optional(),
  label: z.string().trim().min(1).max(80).optional(),
  blockType: z.enum(TimeBlockType).optional(),
  color: optionalText(20),
  isActive: z.boolean().optional(),
});

/** Minutes between two HH:MM strings. */
export function blockMinutes(startTime: string, endTime: string): number {
  const [startHour, startMinute] = startTime.split(":").map(Number) as [number, number];
  const [endHour, endMinute] = endTime.split(":").map(Number) as [number, number];
  return endHour * 60 + endMinute - (startHour * 60 + startMinute);
}
