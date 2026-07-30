import { StatusCategory } from "@/lib/generated/prisma/enums";

/**
 * The canonical AR claim status list (build spec §4).
 *
 * Every status label used anywhere in the AR module must come from here, and
 * every label -> category derivation must go through statusLabelToCategory().
 * Never hard-code a category next to a label at the call site.
 */

export const GREEN_STATUSES = [
  "Appeal Submitted",
  "In Process",
  "Paid & Posted",
  "Pt Resp",
  "Recently Paid",
  "Reissued",
  "Reprocessed",
  "Resubmitted",
  "Written Off",
  "Appeal in Process",
] as const;

export const BLUE_STATUSES = [
  "Check with Office",
  "Inactive Insurance",
  "Provider OON",
] as const;

export const RED_STATUSES = [
  "Need to Appeal",
  "Need to Call",
  "Need to Resubmit",
  "Need to Write Off",
  "Paid but not Posted",
  "Pending",
  "Confirm if Cashed",
] as const;

export type StatusLabel =
  | (typeof GREEN_STATUSES)[number]
  | (typeof BLUE_STATUSES)[number]
  | (typeof RED_STATUSES)[number];

export const ALL_STATUSES: StatusLabel[] = [
  ...GREEN_STATUSES,
  ...BLUE_STATUSES,
  ...RED_STATUSES,
];

/** Every claim starts here on import. */
export const DEFAULT_STATUS_LABEL: StatusLabel = "Pending";
export const DEFAULT_STATUS_CATEGORY = StatusCategory.RED;

const CATEGORY_BY_LABEL = new Map<string, StatusCategory>([
  ...GREEN_STATUSES.map(
    (label) => [label.toLowerCase(), StatusCategory.GREEN] as const,
  ),
  ...BLUE_STATUSES.map(
    (label) => [label.toLowerCase(), StatusCategory.BLUE] as const,
  ),
  ...RED_STATUSES.map(
    (label) => [label.toLowerCase(), StatusCategory.RED] as const,
  ),
]);

/**
 * Maps any of the status labels to its category. Unknown labels fall back to
 * RED — an unrecognised status means work is still outstanding, so it belongs
 * in the biller queue rather than being silently treated as complete.
 */
export function statusLabelToCategory(label: string): StatusCategory {
  return (
    CATEGORY_BY_LABEL.get(label.trim().toLowerCase()) ?? DEFAULT_STATUS_CATEGORY
  );
}

export function isKnownStatusLabel(label: string): label is StatusLabel {
  return CATEGORY_BY_LABEL.has(label.trim().toLowerCase());
}

/** Blue statuses hand the claim back to the PM to chase the practice. */
export function requiresPmReassignment(label: string): boolean {
  return statusLabelToCategory(label) === StatusCategory.BLUE;
}
