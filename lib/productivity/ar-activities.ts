/**
 * AR activity keys and labels.
 *
 * Kept free of Prisma so client components (the detail table, the team table)
 * can import them without dragging the database driver into the browser
 * bundle. The queries themselves live in ./ar-productivity.ts.
 */

export const AR_ACTIVITIES = {
  CLAIMS_WORKED: "ar_claims_worked",
  MOVED_TO_GREEN: "ar_moved_to_green",
  DENIALS_WORKED: "ar_denials_worked",
  RESUBMITTED: "ar_resubmitted",
  APPEALS_SUBMITTED: "ar_appeals_submitted",
  ESCALATED_TO_OFFICE: "ar_escalated_to_office",
} as const;

export type ArActivityKey = (typeof AR_ACTIVITIES)[keyof typeof AR_ACTIVITIES];

export const AR_ACTIVITY_LABELS: Record<ArActivityKey, string> = {
  [AR_ACTIVITIES.CLAIMS_WORKED]: "AR Claims Worked",
  [AR_ACTIVITIES.MOVED_TO_GREEN]: "Claims Moved to Green",
  [AR_ACTIVITIES.DENIALS_WORKED]: "Denials Worked",
  [AR_ACTIVITIES.RESUBMITTED]: "Claims Resubmitted",
  [AR_ACTIVITIES.APPEALS_SUBMITTED]: "Appeals Submitted",
  [AR_ACTIVITIES.ESCALATED_TO_OFFICE]: "Claims Escalated to Office",
};

/** Status labels that count as a resubmission. */
export const RESUBMITTED_STATUSES = [
  "Resubmitted",
  "Corrected and Resubmitted",
];

/** Status labels that count as an appeal submission. */
export const APPEAL_STATUSES = ["Appeal Submitted"];
