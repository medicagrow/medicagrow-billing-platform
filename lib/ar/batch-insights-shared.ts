/**
 * The vocabulary of the batch Analysis and Smart Alerts tabs.
 *
 * **Free of Prisma**, so the client components can import it —
 * `batch-analysis.ts` and `smart-alerts.ts` add the queries.
 */

/* ------------------------------- analysis -------------------------------- */

export const ANALYSIS_DIMENSIONS = [
  "insurance",
  "statusLabel",
  "visitStatus",
  "provider",
  "assignee",
  "statusCategory",
] as const;

export type AnalysisDimension = (typeof ANALYSIS_DIMENSIONS)[number];

export const ANALYSIS_DIMENSION_LABELS: Record<AnalysisDimension, string> = {
  insurance: "Payer / Insurance",
  statusLabel: "AR Status",
  visitStatus: "Visit Status",
  provider: "Provider",
  assignee: "Assignee",
  statusCategory: "Status Category",
};

export function isAnalysisDimension(value: unknown): value is AnalysisDimension {
  return (ANALYSIS_DIMENSIONS as readonly string[]).includes(value as string);
}

export interface AnalysisRow {
  /** The raw grouped value — what a click-through filters on. Null is "none". */
  key: string | null;
  label: string;
  claims: number;
  /** Decimal as a string, summed in cents. */
  balance: string;
  avgAgingDays: number;
  children?: AnalysisRow[];
}

export interface AnalysisResult {
  primary: AnalysisDimension;
  sub: AnalysisDimension | null;
  rows: AnalysisRow[];
  total: Omit<AnalysisRow, "key" | "label" | "children">;
}

export const HOW_CHECKED_FILTERS = ["Portal", "IVR", "Phone"] as const;

/* ----------------------------- smart alerts ------------------------------ */

export type AlertSeverity = "HIGH" | "MEDIUM" | "LOW";

export type AlertCategory =
  | "TIMELY_FILING"
  | "PACE"
  | "QUALITY"
  | "FINANCIAL"
  | "BILLER";

/** Which detector raised an alert — also the key the claim list filters on. */
export type AlertType =
  | "TIMELY_FILING"
  | "PACE"
  | "SYSTEMATIC_DENIAL"
  | "FORGOTTEN_IN_PROCESS"
  | "UNACTIONED_BLUE"
  | "HIGH_BALANCE_IDLE"
  | "AGING_WORSENING"
  | "BILLER_IDLE";

export const ALERT_TYPES: AlertType[] = [
  "TIMELY_FILING",
  "PACE",
  "SYSTEMATIC_DENIAL",
  "FORGOTTEN_IN_PROCESS",
  "UNACTIONED_BLUE",
  "HIGH_BALANCE_IDLE",
  "AGING_WORSENING",
  "BILLER_IDLE",
];

export function isAlertType(value: unknown): value is AlertType {
  return ALERT_TYPES.includes(value as AlertType);
}

export interface SmartAlert {
  /** Deterministic: the same finding carries the same id on every run. */
  id: string;
  type: AlertType;
  category: AlertCategory;
  severity: AlertSeverity;
  title: string;
  description: string;
  affectedCount: number;
  affectedBalance: string;
  /**
   * Query params for the claim list that show exactly the claims this alert
   * covers. Where the list's ordinary filters can express it they are used;
   * otherwise `alert` (and `alertKey`) name the detector, and the list asks the
   * detector for its own condition — so "view affected claims" is the same set
   * the count came from, not an approximation of it.
   */
  claimFilter: Record<string, string>;
}

export const SEVERITY_ORDER: Record<AlertSeverity, number> = {
  HIGH: 0,
  MEDIUM: 1,
  LOW: 2,
};

export const ALERT_TYPE_LABELS: Record<AlertType, string> = {
  TIMELY_FILING: "Timely filing risk",
  PACE: "Behind pace",
  SYSTEMATIC_DENIAL: "Systematic denial",
  FORGOTTEN_IN_PROCESS: "Forgotten In Process",
  UNACTIONED_BLUE: "Unactioned blue claims",
  HIGH_BALANCE_IDLE: "High balance, idle",
  AGING_WORSENING: "Aging worsening",
  BILLER_IDLE: "Biller idle",
};

/** The thresholds, in one place so a change is one edit and the tests agree. */
export const ALERT_THRESHOLDS = {
  timelyFilingMinDays: 90,
  timelyFilingMaxDays: 120,
  timelyFilingQuietDays: 14,
  paceTolerance: 0.15,
  systematicDenialMinClaims: 5,
  forgottenInProcessQuietDays: 30,
  unactionedBlueDays: 3,
  highBalanceMin: 500,
  highBalanceQuietDays: 14,
  agingWorseningWindowDays: 7,
  agingWorseningIncrease: 0.1,
  billerIdleMinRedClaims: 10,
  billerIdleWorkingDays: 3,
} as const;
