import { z } from "zod";
import { EobEntryType, StatusCategory } from "@/lib/generated/prisma/enums";
import { ALL_EOB_STATUSES, eobStatusToCategory } from "@/lib/eob-status";
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

export const eobEntryInputSchema = z.object({
  entryType: z.enum(EobEntryType),
  patientName: z.string().trim().min(1, "Patient name is required").max(150),
  claimNumber: optionalText(80),
  dateOfService: dateStringSchema,
  cptCode: optionalText(20),
  billedAmount: nonNegativeDecimalSchema.optional(),
  deniedAmount: nonNegativeDecimalSchema.optional(),
  denialCode: optionalText(40),
  denialReason: z.string().trim().min(1, "A reason is required").max(300),
  rejectionReason: optionalText(300),
  actionRequired: optionalText(300),
  arClaimId: optionalText(40),
  /**
   * Required: an entry nobody owns sits in the flat list unworked. The poster
   * defaults to themselves, and the route re-checks that the person actually
   * belongs to the practice.
   */
  assignedToId: z.string().min(1, "Each entry needs an assignee"),
});

export const createEobBatchSchema = z.object({
  practiceId: z.string().min(1, "Practice is required"),
  batchDate: dateStringSchema,
  batchReference: optionalText(80),
  payerName: z.string().trim().min(1, "Payer name is required").max(150),
  totalAmount: nonNegativeDecimalSchema,
  notes: optionalText(2000),
  entries: z
    .array(eobEntryInputSchema)
    .min(1, "Add at least one denial or rejection"),
});

export const listEobBatchesQuerySchema = z.object({
  practiceId: z.string().optional(),
  payerName: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

export const listEobEntriesQuerySchema = z.object({
  practiceId: z.string().optional(),
  batchId: z.string().optional(),
  entryType: z.enum(EobEntryType).optional(),
  statusCategory: z.enum(StatusCategory).optional(),
  assignedToId: z.string().optional(),
  unresolved: z.enum(["true", "false"]).optional(),
  /** Substring match on the batch's payer. */
  payerName: z.string().optional(),
  /** `from`/`to` bound the batch date — when the remittance arrived. */
  from: z.string().optional(),
  to: z.string().optional(),
  sort: z
    .enum(["batchDate", "deniedAmount", "patientName", "payerName", "status"])
    .optional(),
  direction: z.enum(["asc", "desc"]).optional(),
});

const eobStatusLabelSchema = z
  .string()
  .refine(
    (label) => (ALL_EOB_STATUSES as string[]).includes(label),
    "Unrecognised status label",
  );

export const createEobWorkNoteSchema = z
  .object({
    entryId: z.string().min(1),
    note: z.string().trim().min(1, "A note is required").max(5000),
    statusChangedTo: eobStatusLabelSchema,
    assignedToChangedId: z.string().min(1).nullable().optional(),
    resolutionNote: optionalText(2000),
    /**
     * Hands the entry to the practice's PM on save, at any status. Blue
     * statuses do this automatically; this is the biller asking for it.
     */
    reassignToPm: z.boolean().optional(),
  })
  .transform((data) => ({
    ...data,
    // Derived server-side; never taken from the client.
    statusCategoryChangedTo: eobStatusToCategory(data.statusChangedTo),
  }));

export const assignEobEntrySchema = z.object({
  assignedToId: z.string().min(1).nullable(),
});

export const bulkAssignEobSchema = z.object({
  entryIds: z.array(z.string().min(1)).min(1, "Select at least one entry"),
  assignedToId: z.string().min(1).nullable(),
});
