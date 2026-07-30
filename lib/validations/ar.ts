import { z } from "zod";
import { OutcomeType, StatusCategory } from "@/lib/generated/prisma/enums";
import { AGING_BUCKET_KEYS } from "@/lib/ar-aging";
import { isStatusValidForOutcome } from "@/lib/ar-outcomes";
import { ALL_STATUSES, statusLabelToCategory } from "@/lib/ar-status";
import { dateStringSchema, nonNegativeDecimalSchema } from "@/lib/validations/common";

const currentYear = new Date().getFullYear();

/**
 * EHR source is no longer supplied at upload — every import is the standard
 * CSV, and the batch inherits Practice.ehrSource for reporting only.
 */
export const createBatchSchema = z.object({
  practiceId: z.string().min(1, "Practice is required"),
  reportMonth: z.coerce
    .number()
    .int()
    .min(1, "Month must be 1–12")
    .max(12, "Month must be 1–12"),
  reportYear: z.coerce
    .number()
    .int()
    .min(2000, "Year looks wrong")
    .max(currentYear + 1, "Year cannot be in the future"),
  targetCompletionDate: dateStringSchema.optional(),
});

export const listBatchesQuerySchema = z.object({
  practiceId: z.string().optional(),
  status: z.enum(["OPEN", "CLOSED"]).optional(),
});

/** Manual single-claim entry into an open batch. */
export const createClaimSchema = z.object({
  batchId: z.string().min(1, "Batch is required"),
  patientName: z.string().trim().min(1, "Patient name is required").max(150),
  dateOfService: dateStringSchema,
  insuranceName: z.string().trim().min(1, "Insurance name is required").max(150),
  providerName: z.string().trim().min(1, "Provider name is required").max(150),
  balance: nonNegativeDecimalSchema,
  billedAmount: nonNegativeDecimalSchema.optional(),
  claimNumber: z.string().trim().max(80).optional(),
  cptCode: z.string().trim().max(20).optional(),
  subscriberId: z.string().trim().max(80).optional(),
  patientId: z.string().trim().max(80).optional(),
  agingDays: z.coerce.number().int().min(0).optional(),
  assignedToId: z.string().min(1).optional(),
});

export const assignClaimSchema = z.object({
  assignedToId: z.string().min(1).nullable(),
});

export const bulkAssignSchema = z.object({
  claimIds: z.array(z.string().min(1)).min(1, "Select at least one claim"),
  assignedToId: z.string().min(1).nullable(),
});

export const listClaimsQuerySchema = z.object({
  batchId: z.string().min(1, "batchId is required"),
  assignedToId: z.string().optional(),
  unassigned: z.enum(["true", "false"]).optional(),
  statusCategory: z.enum(StatusCategory).optional(),
  statusLabel: z.string().optional(),
  insuranceName: z.string().optional(),
  agingBucket: z.enum(AGING_BUCKET_KEYS as [string, ...string[]]).optional(),
  overdue: z.enum(["true", "false"]).optional(),
});

const statusLabelSchema = z
  .string()
  .refine(
    (label) => (ALL_STATUSES as string[]).includes(label),
    "Unrecognised status label",
  );

export const createWorkNoteSchema = z
  .object({
    claimId: z.string().min(1),
    outcomeType: z.enum(OutcomeType),
    structuredFields: z.record(z.string(), z.unknown()).default({}),
    additionalNotes: z.string().trim().max(5000).optional(),
    statusChangedTo: statusLabelSchema,
    followUpDateSet: dateStringSchema.optional(),
    /** Denial reason is captured separately so the API can upsert it. */
    denialReason: z.string().trim().max(300).optional(),
  })
  .refine(
    (data) => isStatusValidForOutcome(data.outcomeType, data.statusChangedTo),
    {
      message: "That status is not available for the selected outcome type.",
      path: ["statusChangedTo"],
    },
  )
  .transform((data) => ({
    ...data,
    // Derived server-side; never trusted from the client.
    statusCategoryChangedTo: statusLabelToCategory(data.statusChangedTo),
  }));

export const closeBatchSchema = z.object({
  confirm: z.literal(true, {
    message: "Closing a batch must be explicitly confirmed.",
  }),
});

export const setTargetDateSchema = z.object({
  targetCompletionDate: dateStringSchema.nullable(),
});

export { nonNegativeDecimalSchema };
