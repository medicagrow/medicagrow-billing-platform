import { StatusCategory } from "@/lib/generated/prisma/enums";

/**
 * EOB entry statuses. Same three-category model as AR, but its own label set —
 * a denial worklist resolves differently from an aged claim.
 *
 * Three labels were consolidated away in the eob_status_consolidation
 * migration: "Corrected and Resubmitted" folded into "Resubmitted" (the note
 * detail carries the distinction), "Awaiting Info from Practice" into "Check
 * with Office", and "Duplicate — Ignore" became "Duplicate". The AR module
 * keeps its own "Corrected and Resubmitted" — that list is separate.
 */

export const EOB_RED_STATUSES = [
  "Pending Review",
  "Need to Resubmit",
  "Need to Appeal",
  "Need to Correct",
  "Need to Call",
] as const;

export const EOB_BLUE_STATUSES = ["Check with Office"] as const;

export const EOB_GREEN_STATUSES = [
  "Resubmitted",
  "Appeal Submitted",
  "Written Off",
  "Resolved",
  "Duplicate",
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
 * Statuses that close an entry out. "Written Off" and "Duplicate" count: the
 * work is finished either way, even without money recovered.
 *
 * Derived from the green list rather than repeated, so consolidating a status
 * cannot leave the two disagreeing.
 */
const RESOLVING_STATUSES = new Set<string>(EOB_GREEN_STATUSES);

export function isResolvingStatus(label: string): boolean {
  return RESOLVING_STATUSES.has(label.trim());
}
