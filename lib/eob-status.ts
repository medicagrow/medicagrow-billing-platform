import { StatusCategory } from "@/lib/generated/prisma/enums";

/**
 * EOB entry statuses. Same three-category model as AR, but its own label set —
 * a denial worklist resolves differently from an aged claim.
 */

export const EOB_RED_STATUSES = [
  "Pending Review",
  "Need to Resubmit",
  "Need to Appeal",
  "Need to Correct",
  "Need to Call",
] as const;

export const EOB_BLUE_STATUSES = [
  "Check with Office",
  "Awaiting Info from Practice",
] as const;

export const EOB_GREEN_STATUSES = [
  "Resubmitted",
  "Appeal Submitted",
  "Corrected and Resubmitted",
  "Written Off",
  "Resolved",
  "Duplicate — Ignore",
] as const;

export type EobStatusLabel =
  | (typeof EOB_RED_STATUSES)[number]
  | (typeof EOB_BLUE_STATUSES)[number]
  | (typeof EOB_GREEN_STATUSES)[number];

export const ALL_EOB_STATUSES: EobStatusLabel[] = [
  ...EOB_RED_STATUSES,
  ...EOB_BLUE_STATUSES,
  ...EOB_GREEN_STATUSES,
];

export const DEFAULT_EOB_STATUS_LABEL: EobStatusLabel = "Pending Review";
export const DEFAULT_EOB_STATUS_CATEGORY = StatusCategory.RED;

const CATEGORY_BY_LABEL = new Map<string, StatusCategory>([
  ...EOB_GREEN_STATUSES.map(
    (label) => [label.toLowerCase(), StatusCategory.GREEN] as const,
  ),
  ...EOB_BLUE_STATUSES.map(
    (label) => [label.toLowerCase(), StatusCategory.BLUE] as const,
  ),
  ...EOB_RED_STATUSES.map(
    (label) => [label.toLowerCase(), StatusCategory.RED] as const,
  ),
]);

/**
 * Unknown labels fall back to RED — outstanding work belongs in the queue
 * rather than being silently treated as done.
 */
export function eobStatusToCategory(label: string): StatusCategory {
  return (
    CATEGORY_BY_LABEL.get(label.trim().toLowerCase()) ??
    DEFAULT_EOB_STATUS_CATEGORY
  );
}

export function isKnownEobStatus(label: string): label is EobStatusLabel {
  return CATEGORY_BY_LABEL.has(label.trim().toLowerCase());
}

/**
 * Statuses that close an entry out. "Written Off" and "Duplicate — Ignore"
 * count: the work is finished either way, even without money recovered.
 */
const RESOLVING_STATUSES = new Set<string>([
  "Resubmitted",
  "Appeal Submitted",
  "Corrected and Resubmitted",
  "Written Off",
  "Resolved",
  "Duplicate — Ignore",
]);

export function isResolvingStatus(label: string): boolean {
  return RESOLVING_STATUSES.has(label.trim());
}
