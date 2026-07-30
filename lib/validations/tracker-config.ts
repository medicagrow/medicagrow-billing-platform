import { z } from "zod";

/**
 * Scoring configuration payloads.
 *
 * Both sections are optional so the settings page can save one tab at a time,
 * but a section that is present must be complete — a half-written weight map
 * would silently redistribute the model.
 */

const scoreBandSchema = z.object({
  max: z.number().finite(),
  score: z.number().min(0).max(100),
});

const bandsSchema = z.object({
  bands: z.array(scoreBandSchema).min(1, "At least one band is required"),
});

export const scoreWeightsSchema = z.object({
  A: z.number().min(0).max(100),
  B: z.number().min(0).max(100),
  C: z.number().min(0).max(100),
  D: z.number().min(0).max(100),
  E: z.number().min(0).max(100),
  F: z.number().min(0).max(100),
  G: z.number().min(0).max(100),
  H: z.number().min(0).max(100),
});

export const scoreRangesSchema = z.object({
  A: bandsSchema,
  B: bandsSchema,
  C_denial: bandsSchema,
  C_outstanding: bandsSchema,
  D: bandsSchema,
  E: bandsSchema,
  F: bandsSchema,
  G: bandsSchema,
  H_meeting: z.object({
    yes: z.number().min(0).max(100),
    no: z.number().min(0).max(100),
  }),
  H_communication: z.object({
    Yes: z.number().min(0).max(100),
    Partial: z.number().min(0).max(100),
    No: z.number().min(0).max(100),
  }),
});

export const updateTrackerConfigSchema = z
  .object({
    weights: scoreWeightsSchema.optional(),
    ranges: scoreRangesSchema.optional(),
  })
  .refine(
    (value) => value.weights !== undefined || value.ranges !== undefined,
    "Nothing to update",
  )
  .refine(
    (value) =>
      value.weights === undefined ||
      // Floating point: 20 + 10 + 15 … can land a hair off 100.
      Math.abs(
        Object.values(value.weights).reduce((sum, weight) => sum + weight, 0) -
          100,
      ) < 0.001,
    {
      message: "Weights must total exactly 100",
      path: ["weights"],
    },
  );
