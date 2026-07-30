import { normalizeHeader } from "@/lib/ar-parsers/utils";

/**
 * Column detection for the standard CSV import.
 *
 * Headers drift between the tools PMs use to standardise their exports, so
 * matching is by similarity rather than exact string. Strategies are applied
 * in order across *all* candidates before falling back to the next, so an
 * exact match on a later candidate always beats a fuzzy match on an earlier
 * one.
 */

/** Shortest header fragment allowed to match by containment. */
const MIN_PARTIAL_LENGTH = 4;

/**
 * How much of the longer string the shorter one must cover for a containment
 * match to count. Without this, a long candidate swallows a short header —
 * "patient_first_name" would claim a plain "Patient" column.
 */
const MIN_CONTAINMENT_RATIO = 0.6;

export type DetectStrategy = "exact" | "normalized" | "partial";

export interface DetectResult {
  index: number;
  header: string | null;
  strategy: DetectStrategy | null;
}

export function detectColumnDetailed(
  headers: string[],
  candidates: string[],
  /** Indices already claimed by another field — never matched again. */
  claimed: ReadonlySet<number> = new Set(),
): DetectResult {
  const miss: DetectResult = { index: -1, header: null, strategy: null };
  const available = (index: number) => !claimed.has(index);

  // 1. Exact match, case-insensitive.
  for (const candidate of candidates) {
    const wanted = candidate.trim().toLowerCase();
    const index = headers.findIndex(
      (header, position) =>
        available(position) && header.trim().toLowerCase() === wanted,
    );
    if (index !== -1) {
      return { index, header: headers[index]!, strategy: "exact" };
    }
  }

  // 2. Match once spaces, underscores and hyphens are removed.
  for (const candidate of candidates) {
    const wanted = normalizeHeader(candidate);
    if (wanted === "") continue;
    const index = headers.findIndex(
      (header, position) =>
        available(position) && normalizeHeader(header) === wanted,
    );
    if (index !== -1) {
      return { index, header: headers[index]!, strategy: "normalized" };
    }
  }

  // 3. Containment either way. Prefer the longest overlap so a more specific
  //    header wins when several could match.
  let best: DetectResult = miss;
  let bestOverlap = 0;

  for (const candidate of candidates) {
    const wanted = normalizeHeader(candidate);
    if (wanted.length < MIN_PARTIAL_LENGTH) continue;

    headers.forEach((header, index) => {
      if (!available(index)) return;

      const normalized = normalizeHeader(header);
      if (normalized.length < MIN_PARTIAL_LENGTH) return;

      const contains =
        normalized.includes(wanted) || wanted.includes(normalized);
      if (!contains) return;

      const shorter = Math.min(normalized.length, wanted.length);
      const longer = Math.max(normalized.length, wanted.length);
      if (shorter / longer < MIN_CONTAINMENT_RATIO) return;

      const overlap = shorter;
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        best = { index, header, strategy: "partial" };
      }
    });
  }

  return best;
}

/** Index of the best-matching header, or -1. */
export function detectColumn(headers: string[], candidates: string[]): number {
  return detectColumnDetailed(headers, candidates).index;
}

/* ----------------------------- field aliases ------------------------------ */

export const FIELD_CANDIDATES = {
  // Deliberately no bare "name": it containment-matches first_name,
  // last_name and provider_name, and would steal those columns.
  patient_name: ["patient_name", "patientname", "patient", "client"],
  first_name: ["first_name", "patient_first_name", "firstname"],
  last_name: ["last_name", "patient_last_name", "lastname"],
  date_of_service: ["date_of_service", "dos", "service_date", "date"],
  provider_name: [
    "provider_name",
    "provider",
    "rendering_provider",
    "clinician_name",
    "clinician",
  ],
  insurance_name: [
    "insurance_name",
    "insurance",
    "payer_name",
    "payer",
    "primary_insurer_name",
  ],
  billed_amount: ["billed_amount", "billed", "charges", "charge_amount", "rate"],
  balance: ["balance", "ins_balance", "insurance_balance", "amount_due"],
  cpt_code: ["cpt_code", "cpt", "procedure_code", "service_code"],
  claim_number: ["claim_number", "claim_no", "claim", "clearinghouse_reference"],
  subscriber_id: ["subscriber_id", "subscriber_no", "member_id", "subscriber"],
  patient_id: ["patient_id", "patient_acct_no", "account_number", "patient_account"],
  aging_days: ["aging_days", "aging", "days_aged", "age_days"],
} as const;

export type FieldKey = keyof typeof FIELD_CANDIDATES;

export const REQUIRED_FIELDS = [
  "patient_name",
  "date_of_service",
  "provider_name",
  "insurance_name",
  "billed_amount",
  "balance",
] as const;

export const OPTIONAL_FIELDS = [
  "cpt_code",
  "claim_number",
  "subscriber_id",
  "patient_id",
  "aging_days",
] as const;

export type RequiredField = (typeof REQUIRED_FIELDS)[number];
export type OptionalField = (typeof OPTIONAL_FIELDS)[number];

/** Sentinel for "assemble patient_name from the first/last name columns". */
export const MERGE_SENTINEL = "__merge__";

/** Human labels for the mapping table and data preview headers. */
export const FIELD_LABELS: Record<RequiredField | OptionalField, string> = {
  patient_name: "Patient Name",
  date_of_service: "Date of Service",
  provider_name: "Provider Name",
  insurance_name: "Insurance Name",
  billed_amount: "Billed Amount",
  balance: "Balance",
  cpt_code: "CPT Code",
  claim_number: "Claim #",
  subscriber_id: "Subscriber ID",
  patient_id: "Patient ID",
  aging_days: "Aging Days",
};

/**
 * The PM-confirmed mapping. Values are column header text as it appears in the
 * file, `MERGE_SENTINEL` for the first+last merge, or null for "not mapped".
 */
export interface FieldMapping {
  patient_name: string | null;
  first_name_col: string | null;
  last_name_col: string | null;
  date_of_service: string | null;
  provider_name: string | null;
  insurance_name: string | null;
  billed_amount: string | null;
  balance: string | null;
  cpt_code: string | null;
  claim_number: string | null;
  subscriber_id: string | null;
  patient_id: string | null;
  aging_days: string | null;
}

/**
 * Runs auto-detection over the header row and returns it as a FieldMapping,
 * which seeds the dropdowns the PM can then override.
 */
export function autoFieldMapping(headers: string[]): FieldMapping {
  const index: Partial<Record<FieldKey, number>> = {};
  const claimed = new Set<number>();

  for (const field of FIELD_RESOLUTION_ORDER) {
    const detected = detectColumnDetailed(
      headers,
      [...FIELD_CANDIDATES[field]],
      claimed,
    );

    if (detected.index !== -1) {
      index[field] = detected.index;
      claimed.add(detected.index);
    }
  }

  const headerAt = (field: FieldKey) => {
    const position = index[field];
    return position === undefined ? null : headers[position]!;
  };

  const firstNameCol = headerAt("first_name");
  const lastNameCol = headerAt("last_name");
  const patientNameCol = headerAt("patient_name");

  // A dedicated patient_name column wins; otherwise merge first + last.
  const mergeAvailable = Boolean(firstNameCol && lastNameCol);

  return {
    patient_name:
      patientNameCol ?? (mergeAvailable ? MERGE_SENTINEL : null),
    first_name_col: firstNameCol,
    last_name_col: lastNameCol,
    date_of_service: headerAt("date_of_service"),
    provider_name: headerAt("provider_name"),
    insurance_name: headerAt("insurance_name"),
    billed_amount: headerAt("billed_amount"),
    balance: headerAt("balance"),
    cpt_code: headerAt("cpt_code"),
    claim_number: headerAt("claim_number"),
    subscriber_id: headerAt("subscriber_id"),
    patient_id: headerAt("patient_id"),
    aging_days: headerAt("aging_days"),
  };
}

/** Required fields left unmapped, for blocking the import. */
export function missingRequiredFields(mapping: FieldMapping): RequiredField[] {
  return REQUIRED_FIELDS.filter((field) => {
    if (field === "patient_name") {
      if (mapping.patient_name === MERGE_SENTINEL) {
        return !(mapping.first_name_col && mapping.last_name_col);
      }
      return !mapping.patient_name;
    }
    return !mapping[field];
  });
}

/**
 * Resolution order. Each field claims its column exclusively, so the more
 * specific names are resolved before the ones that could swallow them —
 * first/last before patient_name, patient_id before the generic identifiers.
 */
export const FIELD_RESOLUTION_ORDER: FieldKey[] = [
  "first_name",
  "last_name",
  "patient_name",
  "patient_id",
  "subscriber_id",
  "claim_number",
  "date_of_service",
  "provider_name",
  "insurance_name",
  "billed_amount",
  "balance",
  "cpt_code",
  "aging_days",
];
