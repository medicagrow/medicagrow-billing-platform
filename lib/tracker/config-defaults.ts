/**
 * Owner-editable scoring configuration.
 *
 * Weights and score bands live in the database so the model can be retuned
 * without a deploy. Reads are cached in memory for five minutes — scoring runs
 * on every keystroke of the live preview and on every row of the tracker
 * table, and none of that should hit the database.
 */

export interface ScoreBand {
  /**
   * Upper bound, **inclusive** — a value equal to `max` scores this band. The
   * last band uses a sentinel like 999 to catch everything above.
   */
  max: number;
  score: number;
}

export interface ScoreRanges {
  A: { bands: ScoreBand[] };
  B: { bands: ScoreBand[] };
  C_denial: { bands: ScoreBand[] };
  C_outstanding: { bands: ScoreBand[] };
  D: { bands: ScoreBand[] };
  E: { bands: ScoreBand[] };
  F: { bands: ScoreBand[] };
  G: { bands: ScoreBand[] };
  H_meeting: { yes: number; no: number };
  H_communication: { Yes: number; Partial: number; No: number };
}

export type ScoreWeights = Record<
  "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H",
  number
>;

export const CONFIG_KEYS = {
  WEIGHTS: "score_weights",
  RANGES: "score_ranges",
} as const;

export const DEFAULT_WEIGHTS: ScoreWeights = {
  A: 20,
  B: 10,
  C: 15,
  D: 20,
  E: 20,
  F: 5,
  G: 5,
  H: 5,
};

export const DEFAULT_RANGES: ScoreRanges = {
  A: {
    bands: [
      { max: 60, score: 40 },
      { max: 70, score: 60 },
      { max: 80, score: 80 },
      { max: 999, score: 100 },
    ],
  },
  B: {
    bands: [
      { max: 0, score: 100 },
      { max: 5, score: 80 },
      { max: 20, score: 60 },
      { max: 999, score: 40 },
    ],
  },
  C_denial: {
    bands: [
      { max: 5, score: 100 },
      { max: 8, score: 80 },
      { max: 12, score: 60 },
      { max: 999, score: 40 },
    ],
  },
  C_outstanding: {
    bands: [
      { max: 0, score: 100 },
      { max: 10, score: 80 },
      { max: 30, score: 60 },
      { max: 999, score: 40 },
    ],
  },
  D: {
    bands: [
      { max: 10, score: 100 },
      { max: 15, score: 80 },
      { max: 25, score: 60 },
      { max: 999, score: 40 },
    ],
  },
  E: {
    bands: [
      { max: 65, score: 40 },
      { max: 80, score: 60 },
      { max: 90, score: 80 },
      { max: 999, score: 100 },
    ],
  },
  F: {
    bands: [
      { max: 70, score: 40 },
      { max: 85, score: 60 },
      { max: 95, score: 80 },
      { max: 999, score: 100 },
    ],
  },
  G: {
    bands: [
      { max: 60, score: 40 },
      { max: 80, score: 60 },
      { max: 90, score: 80 },
      { max: 999, score: 100 },
    ],
  },
  H_meeting: { yes: 100, no: 0 },
  H_communication: { Yes: 100, Partial: 30, No: 0 },
};

export interface TrackerConfig {
  weights: ScoreWeights;
  ranges: ScoreRanges;
}

export const DEFAULT_CONFIG: TrackerConfig = {
  weights: DEFAULT_WEIGHTS,
  ranges: DEFAULT_RANGES,
};

/** Weights must total 100 so the redistribution maths stays meaningful. */
export function weightsTotal(weights: ScoreWeights): number {
  return Object.values(weights).reduce((sum, value) => sum + value, 0);
}
