import { prisma } from "@/lib/prisma";
import {
  CONFIG_KEYS,
  DEFAULT_RANGES,
  DEFAULT_WEIGHTS,
  type ScoreBand,
  type ScoreRanges,
  type ScoreWeights,
  type TrackerConfig,
} from "@/lib/tracker/config-defaults";

/**
 * Database-backed reads of the scoring configuration.
 *
 * The defaults, types and pure helpers live in config-defaults.ts so client
 * components can import them without pulling pg into the browser bundle.
 */

export * from "@/lib/tracker/config-defaults";

const CACHE_TTL_MS = 5 * 60 * 1000;

let cached: { value: TrackerConfig; expiresAt: number } | null = null;

/** Drops the cache so a save takes effect immediately. */
export function invalidateTrackerConfigCache() {
  cached = null;
}

function isScoreBandArray(value: unknown): value is ScoreBand[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (band) =>
        typeof band === "object" &&
        band !== null &&
        Number.isFinite((band as ScoreBand).max) &&
        Number.isFinite((band as ScoreBand).score),
    )
  );
}

/** Merges stored values over the defaults, ignoring anything malformed. */
function mergeRanges(stored: unknown): ScoreRanges {
  if (!stored || typeof stored !== "object") return DEFAULT_RANGES;

  const source = stored as Record<string, unknown>;
  const merged: ScoreRanges = structuredClone(DEFAULT_RANGES);

  for (const key of [
    "A", "B", "C_denial", "C_outstanding", "D", "E", "F", "G",
  ] as const) {
    const entry = source[key] as { bands?: unknown } | undefined;
    if (entry && isScoreBandArray(entry.bands)) {
      merged[key] = { bands: [...entry.bands].sort((a, b) => a.max - b.max) };
    }
  }

  const meeting = source.H_meeting as Partial<ScoreRanges["H_meeting"]> | undefined;
  if (meeting && Number.isFinite(meeting.yes) && Number.isFinite(meeting.no)) {
    merged.H_meeting = { yes: Number(meeting.yes), no: Number(meeting.no) };
  }

  const communication = source.H_communication as
    | Partial<ScoreRanges["H_communication"]>
    | undefined;
  if (communication) {
    merged.H_communication = {
      Yes: Number(communication.Yes ?? DEFAULT_RANGES.H_communication.Yes),
      Partial: Number(
        communication.Partial ?? DEFAULT_RANGES.H_communication.Partial,
      ),
      No: Number(communication.No ?? DEFAULT_RANGES.H_communication.No),
    };
  }

  return merged;
}

function mergeWeights(stored: unknown): ScoreWeights {
  if (!stored || typeof stored !== "object") return DEFAULT_WEIGHTS;

  const source = stored as Record<string, unknown>;
  const merged = { ...DEFAULT_WEIGHTS };

  for (const key of Object.keys(DEFAULT_WEIGHTS) as (keyof ScoreWeights)[]) {
    const value = Number(source[key]);
    if (Number.isFinite(value) && value >= 0) merged[key] = value;
  }

  return merged;
}

/** Reads config, seeding the defaults the first time it is requested. */
export async function getTrackerConfig(): Promise<TrackerConfig> {
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const rows = await prisma.trackerConfig.findMany({
    where: { configKey: { in: [CONFIG_KEYS.WEIGHTS, CONFIG_KEYS.RANGES] } },
  });

  const weightsRow = rows.find((row) => row.configKey === CONFIG_KEYS.WEIGHTS);
  const rangesRow = rows.find((row) => row.configKey === CONFIG_KEYS.RANGES);

  // Seed on first read so the settings page always has something to edit.
  if (!weightsRow || !rangesRow) {
    await prisma.trackerConfig.createMany({
      data: [
        ...(weightsRow
          ? []
          : [
              {
                configKey: CONFIG_KEYS.WEIGHTS,
                configValue: DEFAULT_WEIGHTS as object,
              },
            ]),
        ...(rangesRow
          ? []
          : [
              {
                configKey: CONFIG_KEYS.RANGES,
                configValue: DEFAULT_RANGES as unknown as object,
              },
            ]),
      ],
      skipDuplicates: true,
    });
  }

  const value: TrackerConfig = {
    weights: mergeWeights(weightsRow?.configValue),
    ranges: mergeRanges(rangesRow?.configValue),
  };

  cached = { value, expiresAt: Date.now() + CACHE_TTL_MS };

  return value;
}
