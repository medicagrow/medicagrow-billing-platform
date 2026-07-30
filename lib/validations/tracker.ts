import { z } from "zod";

/**
 * Every tracker field is optional and nullable: a practice whose EHR cannot
 * produce a report leaves it blank, and the scoring model excludes it rather
 * than treating it as zero.
 */

const nullableInt = z
  .union([z.number(), z.string(), z.null(), z.undefined()])
  .transform((value) => {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
  })
  .refine((value) => value === null || value >= 0, "Must be zero or more");

const nullableDecimal = z
  .union([z.number(), z.string(), z.null(), z.undefined()])
  .transform((value) => {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(String(value).replace(/[$,\s]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  });

/** Percentage entered 0–100, stored 0–1. */
const nullablePercent = z
  .union([z.number(), z.string(), z.null(), z.undefined()])
  .transform((value) => {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(String(value).replace(/[%\s]/g, ""));
    if (!Number.isFinite(parsed)) return null;
    return Math.min(1, Math.max(0, parsed / 100));
  });

export const upsertTrackerEntrySchema = z.object({
  practiceId: z.string().min(1, "Practice is required"),
  /** YYYY-MM — the entry covers a whole month. */
  monthYear: z
    .string()
    .regex(/^\d{4}-\d{2}$/, "Month must be in YYYY-MM format"),

  totalAppointments: nullableInt.optional(),
  totalVisits: nullableInt.optional(),
  totalClaims: nullableInt.optional(),

  totalCharges: nullableDecimal.optional(),
  totalPayments: nullableDecimal.optional(),
  totalAdjustments: nullableDecimal.optional(),

  // Manual replacements for the two calculated rates. Entered 0–100 and
  // stored 0–1, like every other percent on this record.
  netCollectionRateManual: nullablePercent.optional(),
  paymentEfficiencyManual: nullablePercent.optional(),

  pendingClaimsToBill: nullableInt.optional(),
  pendingEraToPost: nullableInt.optional(),
  pendingPatientPaymentsToPost: nullableInt.optional(),

  rejectionsReceived: nullableInt.optional(),
  outstandingRejections: nullableInt.optional(),
  eobDenialsReceived: nullableInt.optional(),
  outstandingEobDenials: nullableInt.optional(),

  arCount0to30: nullableInt.optional(),
  arAmount0to30: nullableDecimal.optional(),
  arCount31to60: nullableInt.optional(),
  arAmount31to60: nullableDecimal.optional(),
  arCount61to90: nullableInt.optional(),
  arAmount61to90: nullableDecimal.optional(),
  arCount90plus: nullableInt.optional(),
  arAmount90plus: nullableDecimal.optional(),

  followUpCompliance: nullablePercent.optional(),

  totalAppointmentsForElig: nullableInt.optional(),
  eligibilityCompleted: nullableInt.optional(),

  eftEnrollment: nullablePercent.optional(),
  eraEnrollment: nullablePercent.optional(),
  portalAccess: nullablePercent.optional(),
  feeSchedule: nullablePercent.optional(),
  sopCompliance: nullablePercent.optional(),

  resourcesAssigned: nullableDecimal.optional(),
  // `.optional()` after the transform: otherwise Zod treats an absent key as
  // missing rather than "not provided", and a partial save is rejected.
  monthlyReviewMeeting: z
    .union([z.boolean(), z.null(), z.undefined()])
    .transform((value) => value ?? null)
    .optional(),
  directClientCommunication: z
    .union([z.enum(["Yes", "Partial", "No"]), z.null(), z.undefined()])
    .transform((value) => value ?? null)
    .optional(),
});

export const listTrackerQuerySchema = z.object({
  practiceId: z.string().optional(),
  monthYear: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
  from: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

/** "2026-07" -> UTC midnight on 2026-07-01. */
export function monthYearToDate(monthYear: string): Date {
  const [year, month] = monthYear.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(year, month - 1, 1));
}

export function dateToMonthYear(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}
