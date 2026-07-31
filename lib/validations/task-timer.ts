import { z } from "zod";
import { TimeEditRequestStatus } from "@/lib/generated/prisma/enums";

/** An ISO datetime the browser produced from a datetime-local input. */
const dateTimeSchema = z
  .string()
  .min(1, "A date and time is required")
  .refine(
    (value) => !Number.isNaN(new Date(value).getTime()),
    "Enter a valid date and time",
  )
  .transform((value) => new Date(value));

export const createTimeEditRequestSchema = z
  .object({
    startedAt: dateTimeSchema,
    stoppedAt: dateTimeSchema,
    reason: z.string().trim().min(1, "A reason is required").max(1000),
  })
  .refine((data) => data.stoppedAt > data.startedAt, {
    message: "The end time must be after the start time.",
    path: ["stoppedAt"],
  })
  // A zero-minute correction is not a correction.
  .refine(
    (data) => data.stoppedAt.getTime() - data.startedAt.getTime() >= 60_000,
    { message: "The corrected time must be at least one minute.", path: ["stoppedAt"] },
  );

export const reviewTimeEditRequestSchema = z.object({
  status: z.enum([
    TimeEditRequestStatus.APPROVED,
    TimeEditRequestStatus.REJECTED,
  ]),
  reviewNote: z
    .union([z.string(), z.null(), z.undefined()])
    .transform((value) => (value ?? "").trim())
    .transform((value) => (value === "" ? undefined : value.slice(0, 1000)))
    // A transform pipeline hides that undefined is acceptable.
    .optional(),
});
