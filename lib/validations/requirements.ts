import { z } from "zod";

/**
 * Monthly requirement for one task type at one practice.
 *
 * Hours rather than minutes: this is a number a PM commits to in a
 * conversation about staffing, and nobody says "1,800 minutes of payment
 * posting". Zero is meaningful — it records "we looked at this and it is not
 * required" — which is different from never having been set.
 */
export const upsertRequirementSchema = z.object({
  taskTypeId: z.string().min(1, "Task type is required"),
  /**
   * A Decimal-safe string, as money is. A month has 730 hours; anything past
   * that is a typo rather than a plan.
   */
  monthlyHours: z
    .string()
    .trim()
    .regex(/^\d{1,4}(\.\d{1,2})?$/, "Hours must be a number, e.g. 12.5")
    .refine((value) => Number(value) <= 730, "That is more hours than a month has"),
  notes: z
    .union([z.string(), z.null(), z.undefined()])
    .transform((value) => (value ?? "").trim() || null)
    // A transform pipeline hides that undefined is acceptable.
    .optional(),
});

export type UpsertRequirementInput = z.infer<typeof upsertRequirementSchema>;
