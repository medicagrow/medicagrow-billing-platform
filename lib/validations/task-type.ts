import { z } from "zod";

export const createTaskTypeSchema = z.object({
  name: z.string().trim().min(1, "A name is required").max(60),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
  isActive: z.boolean().default(true),
});

export const updateTaskTypeSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
  isActive: z.boolean().optional(),
});

export const listTaskTypesQuerySchema = z.object({
  /** "true" restricts to types still offered in the pickers. */
  activeOnly: z.enum(["true", "false"]).optional(),
});
