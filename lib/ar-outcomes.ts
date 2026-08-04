import { OutcomeType } from "@/lib/generated/prisma/enums";
import type { StatusLabel } from "@/lib/ar-status";

/**
 * Statuses that hand the balance up, and statuses that hand the claim back to
 * the practice. Both used to be outcome types of their own; they are now
 * endings that any outcome can reach, so the fields they need are shown
 * against the status rather than against a separate form.
 */
export const WRITE_OFF_STATUSES = ["Written Off", "Need to Write Off"];

export const OFFICE_STATUSES = [
  "Check with Office",
  "Inactive Insurance",
  "Provider OON",
];

/**
 * Which statuses a biller may set for each outcome (build spec §9.1–9.7).
 * The note form's status dropdown is filtered through this, and the API
 * re-validates against it — a client cannot set an unrelated status.
 */
export const STATUSES_BY_OUTCOME: Record<OutcomeType, StatusLabel[]> = {
  // "Confirm if Cashed" is RED on purpose: the payer says it paid, but until
  // the cheque is confirmed cashed the claim is still work.
  [OutcomeType.PAID]: [
    "Recently Paid",
    "Paid & Posted",
    "Paid but not Posted",
    "Confirm if Cashed",
    "Check with Office",
    "Inactive Insurance",
    "Provider OON",
  ],
  [OutcomeType.DENIED]: [
    "Need to Appeal",
    "Appeal Submitted",
    "Appeal in Process",
    "Need to Resubmit",
    "Resubmitted",
    "Written Off",
    "Need to Write Off",
    "Check with Office",
    "Inactive Insurance",
    "Provider OON",
  ],
  [OutcomeType.NO_CLAIM_ON_FILE]: [
    "Need to Resubmit",
    "Resubmitted",
    "Need to Call",
    "Written Off",
    "Need to Write Off",
    "Check with Office",
  ],
  [OutcomeType.PATIENT_RESPONSIBILITY]: ["Pt Resp"],
  [OutcomeType.IN_PROCESS]: [
    "In Process",
    "Need to Call",
    "Pending",
    "Check with Office",
  ],
  /** @deprecated retired as an outcome; kept so historical notes still read. */
  [OutcomeType.CHECK_WITH_OFFICE]: [
    "Check with Office",
    "Inactive Insurance",
    "Provider OON",
  ],
  /** @deprecated retired as an outcome; kept so historical notes still read. */
  [OutcomeType.WRITE_OFF]: ["Need to Write Off", "Written Off"],
  [OutcomeType.OTHER]: [
    "Pending",
    "Need to Call",
    "In Process",
    "Check with Office",
  ],
};

/**
 * Outcomes that can no longer be chosen.
 *
 * Write Off and Check with Office were never really outcomes of a follow-up
 * call — they were what you decided afterwards, which meant a denial that
 * ended in a write-off had to be filed as one or the other and lost the denial
 * detail. Their statuses now live under the outcomes that actually lead to
 * them. Existing notes keep their outcome and stay readable; only the picker
 * has changed.
 */
export const DEPRECATED_OUTCOME_TYPES: OutcomeType[] = [
  OutcomeType.CHECK_WITH_OFFICE,
  OutcomeType.WRITE_OFF,
];

export function isDeprecatedOutcome(outcomeType: OutcomeType): boolean {
  return DEPRECATED_OUTCOME_TYPES.includes(outcomeType);
}

/** A note ending in a write-off states the amount and why. */
export function needsWriteOffFields(statusLabel: string): boolean {
  return WRITE_OFF_STATUSES.includes(statusLabel);
}

/** A note going back to the practice states what the practice must supply. */
export function needsOfficeFields(statusLabel: string): boolean {
  return OFFICE_STATUSES.includes(statusLabel);
}

export const OUTCOME_LABELS: Record<OutcomeType, string> = {
  [OutcomeType.PAID]: "Paid",
  [OutcomeType.DENIED]: "Denied",
  [OutcomeType.NO_CLAIM_ON_FILE]: "No Claim on File",
  [OutcomeType.PATIENT_RESPONSIBILITY]: "Patient Responsibility",
  [OutcomeType.IN_PROCESS]: "In Process / Pending",
  [OutcomeType.CHECK_WITH_OFFICE]: "Check with Office",
  [OutcomeType.WRITE_OFF]: "Write Off",
  [OutcomeType.OTHER]: "Other",
};

/** What the outcome picker offers — deprecated outcomes are not on it. */
export const OUTCOME_ORDER: OutcomeType[] = [
  OutcomeType.PAID,
  OutcomeType.DENIED,
  OutcomeType.NO_CLAIM_ON_FILE,
  OutcomeType.PATIENT_RESPONSIBILITY,
  OutcomeType.IN_PROCESS,
  OutcomeType.OTHER,
];

export const PAYMENT_TYPES = ["Check", "EFT", "VCC"] as const;
export const PAYMENT_SCOPES = ["Single", "Bulk"] as const;
export const HOW_CHECKED_OPTIONS = ["Portal", "IVR", "Phone"] as const;
export const URGENCY_OPTIONS = ["Normal", "Urgent"] as const;

/**
 * Write-off categories. AR write-offs are reported by reason, and "timely
 * filing" in particular is tracked separately because it is preventable
 * revenue loss rather than a contractual adjustment.
 */
export const WRITE_OFF_TYPES = [
  "Contractual Adjustment",
  "Timely Filing",
  "Small Balance",
  "Non-Covered Service",
  "Provider Not Credentialed",
  "Bad Debt",
  "Charity Care",
  "Other",
] as const;

export const DENIAL_ACTIONS = [
  "Appealed",
  "Resubmitted",
  "Corrected and Resubmitted",
  "Pending Appeal",
  "No Action Yet",
  "Other",
] as const;

export const NO_CLAIM_ACTIONS = [
  "Resubmitted",
  "Contacted Clearinghouse",
  "Pending Resubmission",
] as const;

export function isStatusValidForOutcome(
  outcomeType: OutcomeType,
  statusLabel: string,
): boolean {
  return (STATUSES_BY_OUTCOME[outcomeType] as string[]).includes(statusLabel);
}
