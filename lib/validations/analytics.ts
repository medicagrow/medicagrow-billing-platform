import { z } from "zod";
import { FLAG_TYPES } from "@/lib/analytics/suspicious-activity";

/**
 * Setting a suspicious-activity flag aside, or bringing it back.
 *
 * The key is opaque to the client — it comes from the report and goes back
 * unchanged — so it is length-bounded rather than parsed.
 */
export const dismissFlagSchema = z.object({
  flagKey: z.string().trim().min(1).max(200),
  flagType: z.enum(FLAG_TYPES),
  note: z
    .union([z.string(), z.null(), z.undefined()])
    .transform((value) => (value ?? "").trim() || null)
    // A transform pipeline hides that undefined is acceptable.
    .optional(),
  /** False restores it to the list, for a dismissal made in error. */
  dismissed: z.boolean().default(true),
});
