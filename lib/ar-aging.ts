import { NOT_ACTIONABLE_MAX_DAYS } from "@/lib/ar-actionable";

export const AGING_BUCKETS = [
  { key: "0-30", label: "0–30 days", min: 0, max: 30 },
  { key: "31-60", label: "31–60 days", min: 31, max: 60 },
  { key: "61-90", label: "61–90 days", min: 61, max: 90 },
  { key: "91-120", label: "91–120 days", min: 91, max: 120 },
  { key: "120+", label: "120+ days", min: 121, max: Number.MAX_SAFE_INTEGER },
] as const;

export type AgingBucketKey = (typeof AGING_BUCKETS)[number]["key"];

export const AGING_BUCKET_KEYS = AGING_BUCKETS.map((bucket) => bucket.key);

export function bucketForAge(agingDays: number): AgingBucketKey {
  return (
    AGING_BUCKETS.find(
      (bucket) => agingDays >= bucket.min && agingDays <= bucket.max,
    )?.key ?? "120+"
  );
}

/** Prisma agingDays filter for a bucket key, or undefined when unrecognised. */
export function agingBucketFilter(key: string) {
  const bucket = AGING_BUCKETS.find((candidate) => candidate.key === key);
  if (!bucket) return undefined;

  return bucket.max === Number.MAX_SAFE_INTEGER
    ? { gte: bucket.min }
    : { gte: bucket.min, lte: bucket.max };
}

/**
 * Tailwind classes for the aging badge — grey under 30 days, then amber
 * through red.
 *
 * The 0–30 bucket is deliberately **not** green. Green reads as "healthy, no
 * action needed", and what a fresh claim actually means is "there is nothing
 * to do here yet" — a different statement, and the one the queue and the
 * completion rate act on. See lib/ar-actionable.ts.
 */
export function agingBadgeClasses(agingDays: number): string {
  if (agingDays <= NOT_ACTIONABLE_MAX_DAYS) {
    return "bg-slate-100 text-slate-600 ring-slate-200";
  }
  if (agingDays <= 60) return "bg-amber-50 text-amber-700 ring-amber-200";
  if (agingDays <= 90) return "bg-orange-50 text-orange-700 ring-orange-200";
  return "bg-red-50 text-red-700 ring-red-200";
}
