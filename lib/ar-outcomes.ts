import { OutcomeType } from "@/lib/generated/prisma/enums";
import type { StatusLabel } from "@/lib/ar-status";

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
  ],
  [OutcomeType.DENIED]: [
    "Need to Appeal",
    "Appeal Submitted",
    "Appeal in Process",
    "Need to Resubmit",
    "Resubmitted",
    "Check with Office",
    "Inactive Insurance",
    "Provider OON",
  ],
  [OutcomeType.NO_CLAIM_ON_FILE]: [
    "Need to Resubmit",
    "Resubmitted",
    "Need to Call",
  ],
  [OutcomeType.PATIENT_RESPONSIBILITY]: ["Pt Resp"],
  [OutcomeType.IN_PROCESS]: ["In Process", "Need to Call", "Pending"],
  [OutcomeType.CHECK_WITH_OFFICE]: [
    "Check with Office",
    "Inactive Insurance",
    "Provider OON",
  ],
  [OutcomeType.WRITE_OFF]: ["Need to Write Off", "Written Off"],
  [OutcomeType.OTHER]: [
    "Pending",
    "Need to Call",
    "In Process",
    "Check with Office",
  ],
};

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

export const OUTCOME_ORDER: OutcomeType[] = [
  OutcomeType.PAID,
  OutcomeType.DENIED,
  OutcomeType.NO_CLAIM_ON_FILE,
  OutcomeType.PATIENT_RESPONSIBILITY,
  OutcomeType.IN_PROCESS,
  OutcomeType.CHECK_WITH_OFFICE,
  OutcomeType.WRITE_OFF,
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
