/**
 * What "how much did you get done" means, per task type.
 *
 * Keyed by task type *name*, matched case-insensitively, because the type list
 * is owner-editable data rather than an enum — an owner renaming a type simply
 * drops it back to no productivity fields, which is the safe direction.
 *
 * Free of Prisma so the task form can import it.
 */

export interface ProductivityConfig {
  showCount: boolean;
  /** e.g. "Claims Followed Up" */
  countLabel: string;
  showAmount: boolean;
  /** e.g. "Total Charge Amount" */
  amountLabel: string;
  /**
   * When set, the count comes from work already logged in that module and is
   * read-only here — a number typed by hand would compete with the audit
   * trail rather than agree with it.
   */
  autoSourceModule?: "AR" | "EOB";
}

export const PRODUCTIVITY_BY_TASK_TYPE: Record<string, ProductivityConfig> = {
  "Charge Posting": {
    showCount: true,
    countLabel: "Charges Posted",
    showAmount: true,
    amountLabel: "Total Charge Amount",
  },
  "Payment Posting": {
    showCount: true,
    countLabel: "Payments Posted",
    showAmount: true,
    amountLabel: "Total Payment Amount",
  },
  "Denial/Rejection Work": {
    showCount: true,
    countLabel: "Denials/Rejections Worked",
    showAmount: true,
    amountLabel: "Total Denied Amount",
    autoSourceModule: "EOB",
  },
  "Claim Follow-up": {
    showCount: true,
    countLabel: "Claims Followed Up",
    showAmount: false,
    amountLabel: "",
    autoSourceModule: "AR",
  },
  Authorization: {
    showCount: true,
    countLabel: "Authorizations Processed",
    showAmount: false,
    amountLabel: "",
  },
  "Eligibility Check": {
    showCount: true,
    countLabel: "Eligibility Checks Done",
    showAmount: false,
    amountLabel: "",
  },
  Report: {
    showCount: true,
    countLabel: "Reports Completed",
    showAmount: false,
    amountLabel: "",
  },
  "Patient Inquiry": {
    showCount: true,
    countLabel: "Patient Inquiries Handled",
    showAmount: false,
    amountLabel: "",
  },
  "Clinic Inquiry": {
    showCount: true,
    countLabel: "Clinic Inquiries Handled",
    showAmount: false,
    amountLabel: "",
  },
};

const BY_LOWERCASE_NAME = new Map(
  Object.entries(PRODUCTIVITY_BY_TASK_TYPE).map(([name, config]) => [
    name.toLowerCase(),
    config,
  ]),
);

/** The config for a task type name, or null when it has none. */
export function productivityConfigFor(
  taskTypeName: string | null | undefined,
): ProductivityConfig | null {
  if (!taskTypeName) return null;
  return BY_LOWERCASE_NAME.get(taskTypeName.trim().toLowerCase()) ?? null;
}

export const AUTO_SOURCE_NOTE: Record<
  NonNullable<ProductivityConfig["autoSourceModule"]>,
  string
> = {
  AR: "Auto-calculated from AR Follow-up module",
  EOB: "Auto-calculated from EOB module",
};
