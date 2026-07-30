import {
  DEFAULT_CONFIG,
  DEFAULT_WEIGHTS,
  weightsTotal,
  type ScoreBand,
  type ScoreRanges,
  type ScoreWeights,
  type TrackerConfig,
} from "@/lib/tracker/config-defaults";

/**
 * Practice health scoring.
 *
 * Three rules shape everything here:
 *
 *  1. A score is null when its inputs are unavailable — not zero. Some EHRs
 *     cannot produce some reports, and scoring a missing report as zero would
 *     punish the practice for its vendor.
 *  2. The final score is a weighted average of the scores that *do* exist,
 *     with the missing weights redistributed proportionally across them.
 *  3. Weights and bands come from TrackerConfig, so the model can be retuned
 *     by the owner without a deploy. Pass the config in; callers that have no
 *     config yet get the documented defaults.
 *
 * All arithmetic is server-side; only scoreA…scoreH and finalScore are stored.
 */

export type ScoreKey =
  | "scoreA"
  | "scoreB"
  | "scoreC"
  | "scoreD"
  | "scoreE"
  | "scoreF"
  | "scoreG"
  | "scoreH";

export const SCORE_KEYS: ScoreKey[] = [
  "scoreA",
  "scoreB",
  "scoreC",
  "scoreD",
  "scoreE",
  "scoreF",
  "scoreG",
  "scoreH",
];

/** Config letter for each score key. */
export const CONFIG_LETTER: Record<ScoreKey, keyof ScoreWeights> = {
  scoreA: "A",
  scoreB: "B",
  scoreC: "C",
  scoreD: "D",
  scoreE: "E",
  scoreF: "F",
  scoreG: "G",
  scoreH: "H",
};

export const SCORE_LABELS: Record<ScoreKey, string> = {
  scoreA: "Net Collection Rate",
  scoreB: "Billing Pipeline",
  scoreC: "Rejections & Denials",
  scoreD: "AR Aging",
  scoreE: "Follow-up Compliance",
  scoreF: "Eligibility Compliance",
  scoreG: "Compliance Setup",
  scoreH: "Team & Management",
};

export const SCORE_DESCRIPTIONS: Record<ScoreKey, string> = {
  scoreA:
    "Share of billed charges resolved — payments plus adjustments over charges.",
  scoreB: "Backlog in the billing queues; the worst queue drives the score.",
  scoreC: "Denial rate and the count of unresolved rejections and denials.",
  scoreD: "Share of outstanding AR sitting beyond 90 days.",
  scoreE: "Share of claims followed up on schedule.",
  scoreF: "Share of appointments with eligibility verified in advance.",
  scoreG: "EFT, ERA, portal, fee schedule and SOP setup completeness.",
  scoreH: "Monthly review, client communication and resourcing.",
};

export interface TrackerInputs {
  totalPayments?: number | null;
  totalAdjustments?: number | null;
  totalCharges?: number | null;

  /** When set, these replace the calculated rates for scoring. */
  netCollectionRateManual?: number | null;
  paymentEfficiencyManual?: number | null;

  pendingClaimsToBill?: number | null;
  pendingEraToPost?: number | null;
  pendingPatientPaymentsToPost?: number | null;

  rejectionsReceived?: number | null;
  outstandingRejections?: number | null;
  eobDenialsReceived?: number | null;
  outstandingEobDenials?: number | null;
  totalClaims?: number | null;

  arAmount0to30?: number | null;
  arAmount31to60?: number | null;
  arAmount61to90?: number | null;
  arAmount90plus?: number | null;

  /** Stored 0–1. */
  followUpCompliance?: number | null;

  totalAppointmentsForElig?: number | null;
  eligibilityCompleted?: number | null;

  /** Each stored 0–1. */
  eftEnrollment?: number | null;
  eraEnrollment?: number | null;
  portalAccess?: number | null;
  feeSchedule?: number | null;
  sopCompliance?: number | null;

  resourcesAssigned?: number | null;
  monthlyReviewMeeting?: boolean | null;
  directClientCommunication?: string | null;
}

export interface DerivedFields {
  netCollectionRate: number | null;
  paymentEfficiency: number | null;
  denialRate: number | null;
  totalAr: number | null;
  arPercentOver90: number | null;
  eligibilityCompliance: number | null;
}

export interface ScoreResult extends DerivedFields {
  /** The rates actually used for scoring, after any manual override. */
  effectiveNetCollectionRate: number | null;
  effectivePaymentEfficiency: number | null;
  netCollectionRateOverridden: boolean;
  paymentEfficiencyOverridden: boolean;

  scoreA: number | null;
  scoreB: number | null;
  scoreC: number | null;
  scoreD: number | null;
  scoreE: number | null;
  scoreF: number | null;
  scoreG: number | null;
  scoreH: number | null;
  finalScore: number | null;
  missingScores: ScoreKey[];
  effectiveWeights: Partial<Record<ScoreKey, number>>;
}

const has = (value: number | null | undefined): value is number =>
  value !== null && value !== undefined && Number.isFinite(value);

/**
 * First band whose exclusive upper bound the value falls under.
 * Bands are assumed sorted ascending by `max`; the last one is the catch-all.
 */
function band(value: number, bands: ScoreBand[]): number {
  const sorted = [...bands].sort((a, b) => a.max - b.max);

  for (const entry of sorted) {
    if (value <= entry.max) return entry.score;
  }

  return sorted[sorted.length - 1]?.score ?? 0;
}

/* ------------------------------ derived ---------------------------------- */

export function deriveFields(inputs: TrackerInputs): DerivedFields {
  const payments = inputs.totalPayments;
  const adjustments = inputs.totalAdjustments;
  const charges = inputs.totalCharges;

  /**
   * Net collection rate — share of billed charges that has been resolved,
   * whether by payment or by adjustment: (payments + adjustments) / charges.
   */
  const netCollectionRate =
    has(payments) && has(adjustments) && has(charges) && charges > 0
      ? (payments + adjustments) / charges
      : null;

  /**
   * Payment efficiency — of the amount resolved, how much was actual cash:
   * payments / (payments + adjustments).
   */
  const paymentEfficiency =
    has(payments) && has(adjustments) && payments + adjustments > 0
      ? payments / (payments + adjustments)
      : null;

  const denialRate =
    has(inputs.eobDenialsReceived) &&
    has(inputs.totalClaims) &&
    inputs.totalClaims > 0
      ? inputs.eobDenialsReceived / inputs.totalClaims
      : null;

  const buckets = [
    inputs.arAmount0to30,
    inputs.arAmount31to60,
    inputs.arAmount61to90,
    inputs.arAmount90plus,
  ];

  const totalAr = buckets.some(has)
    ? buckets.reduce<number>((sum, value) => sum + (has(value) ? value : 0), 0)
    : null;

  const arPercentOver90 =
    totalAr !== null && totalAr > 0 && has(inputs.arAmount90plus)
      ? inputs.arAmount90plus / totalAr
      : totalAr === 0
        ? 0
        : null;

  const eligibilityCompliance =
    has(inputs.totalAppointmentsForElig) &&
    has(inputs.eligibilityCompleted) &&
    inputs.totalAppointmentsForElig > 0
      ? inputs.eligibilityCompleted / inputs.totalAppointmentsForElig
      : null;

  return {
    netCollectionRate,
    paymentEfficiency,
    denialRate,
    totalAr,
    arPercentOver90,
    eligibilityCompliance,
  };
}

/* ------------------------------- scores ---------------------------------- */

function computeScoreA(
  rate: number | null,
  ranges: ScoreRanges,
): number | null {
  if (rate === null) return null;
  return band(rate * 100, ranges.A.bands);
}

function computeScoreB(
  inputs: TrackerInputs,
  ranges: ScoreRanges,
): number | null {
  const pending = [
    inputs.pendingClaimsToBill,
    inputs.pendingEraToPost,
    inputs.pendingPatientPaymentsToPost,
  ].filter(has);

  if (pending.length === 0) return null;

  // The worst queue sets the score — a clear claims queue does not excuse a
  // 50-deep ERA backlog.
  return band(Math.max(...pending), ranges.B.bands);
}

function computeScoreC(
  inputs: TrackerInputs,
  denialRate: number | null,
  ranges: ScoreRanges,
): number | null {
  const denialRateScore =
    denialRate === null ? null : band(denialRate * 100, ranges.C_denial.bands);

  const outstanding = [
    inputs.outstandingRejections,
    inputs.outstandingEobDenials,
  ].filter(has);

  const outstandingScore =
    outstanding.length === 0
      ? null
      : band(
          outstanding.reduce((sum, value) => sum + value, 0),
          ranges.C_outstanding.bands,
        );

  const parts = [denialRateScore, outstandingScore].filter(has);
  if (parts.length === 0) return null;

  return Math.round(parts.reduce((sum, value) => sum + value, 0) / parts.length);
}

function computeScoreD(
  arPercentOver90: number | null,
  ranges: ScoreRanges,
): number | null {
  if (arPercentOver90 === null) return null;
  return band(arPercentOver90 * 100, ranges.D.bands);
}

function computeScoreE(
  followUpCompliance: number | null | undefined,
  ranges: ScoreRanges,
): number | null {
  if (!has(followUpCompliance)) return null;
  return band(followUpCompliance * 100, ranges.E.bands);
}

function computeScoreF(
  eligibilityCompliance: number | null,
  ranges: ScoreRanges,
): number | null {
  if (eligibilityCompliance === null) return null;
  return band(eligibilityCompliance * 100, ranges.F.bands);
}

function computeScoreG(
  inputs: TrackerInputs,
  ranges: ScoreRanges,
): number | null {
  const values = [
    inputs.eftEnrollment,
    inputs.eraEnrollment,
    inputs.portalAccess,
    inputs.feeSchedule,
    inputs.sopCompliance,
  ].filter(has);

  if (values.length === 0) return null;

  const average =
    (values.reduce((sum, value) => sum + value, 0) / values.length) * 100;

  return band(average, ranges.G.bands);
}

function computeScoreH(
  inputs: TrackerInputs,
  ranges: ScoreRanges,
): number | null {
  const parts: number[] = [];

  if (
    inputs.monthlyReviewMeeting !== null &&
    inputs.monthlyReviewMeeting !== undefined
  ) {
    parts.push(
      inputs.monthlyReviewMeeting ? ranges.H_meeting.yes : ranges.H_meeting.no,
    );
  }

  const communication = inputs.directClientCommunication?.trim().toLowerCase();
  if (communication) {
    parts.push(
      communication === "yes"
        ? ranges.H_communication.Yes
        : communication === "partial"
          ? ranges.H_communication.Partial
          : ranges.H_communication.No,
    );
  }

  if (has(inputs.resourcesAssigned)) {
    parts.push(
      inputs.resourcesAssigned >= 2
        ? 100
        : inputs.resourcesAssigned >= 1
          ? 60
          : 40,
    );
  }

  if (parts.length === 0) return null;

  return Math.round(parts.reduce((sum, value) => sum + value, 0) / parts.length);
}

/* ------------------------------- final ----------------------------------- */

export function calculateScores(
  inputs: TrackerInputs,
  config: TrackerConfig = DEFAULT_CONFIG,
): ScoreResult {
  const derived = deriveFields(inputs);
  const { ranges, weights } = config;

  // A manual override replaces the calculated rate for scoring, but the
  // calculated value is still returned so the form can show both.
  const netCollectionRateOverridden = has(inputs.netCollectionRateManual);
  const paymentEfficiencyOverridden = has(inputs.paymentEfficiencyManual);

  const effectiveNetCollectionRate = netCollectionRateOverridden
    ? inputs.netCollectionRateManual!
    : derived.netCollectionRate;

  const effectivePaymentEfficiency = paymentEfficiencyOverridden
    ? inputs.paymentEfficiencyManual!
    : derived.paymentEfficiency;

  const scores: Record<ScoreKey, number | null> = {
    scoreA: computeScoreA(effectiveNetCollectionRate, ranges),
    scoreB: computeScoreB(inputs, ranges),
    scoreC: computeScoreC(inputs, derived.denialRate, ranges),
    scoreD: computeScoreD(derived.arPercentOver90, ranges),
    scoreE: computeScoreE(inputs.followUpCompliance, ranges),
    scoreF: computeScoreF(derived.eligibilityCompliance, ranges),
    scoreG: computeScoreG(inputs, ranges),
    scoreH: computeScoreH(inputs, ranges),
  };

  const available = SCORE_KEYS.filter((key) => scores[key] !== null);
  const missingScores = SCORE_KEYS.filter((key) => scores[key] === null);

  const availableWeight = available.reduce(
    (sum, key) => sum + weights[CONFIG_LETTER[key]],
    0,
  );

  const effectiveWeights: Partial<Record<ScoreKey, number>> = {};
  let finalScore: number | null = null;

  if (available.length > 0 && availableWeight > 0) {
    let weighted = 0;

    for (const key of available) {
      const weight = weights[CONFIG_LETTER[key]] / availableWeight;
      effectiveWeights[key] = weight;
      weighted += (scores[key] as number) * weight;
    }

    finalScore = Math.round(weighted * 100) / 100;
  }

  return {
    ...derived,
    effectiveNetCollectionRate,
    effectivePaymentEfficiency,
    netCollectionRateOverridden,
    paymentEfficiencyOverridden,
    ...scores,
    finalScore,
    missingScores,
    effectiveWeights,
  };
}

/** Shared colour banding for score cells. */
export function scoreTone(score: number | null | undefined) {
  if (score === null || score === undefined) return "none" as const;
  if (score >= 80) return "green" as const;
  if (score >= 60) return "amber" as const;
  return "red" as const;
}

/**
 * Base weights re-keyed by score key and expressed as fractions of the total.
 *
 * Config stores whole percentages under the letters A–H; everything that
 * displays a weight wants `scoreA`-style keys and a fraction, so the
 * conversion happens once here rather than at each call site.
 */
export function weightsByScoreKey(
  weights: ScoreWeights = DEFAULT_WEIGHTS,
): Record<ScoreKey, number> {
  const total = weightsTotal(weights) || 1;

  return SCORE_KEYS.reduce(
    (acc, key) => {
      acc[key] = weights[CONFIG_LETTER[key]] / total;
      return acc;
    },
    {} as Record<ScoreKey, number>,
  );
}
