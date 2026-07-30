import { isBlankRow, parseCsv } from "@/lib/ar-parsers/csv";
import {
  describeDateCorrections,
  detectDateFormat,
  normalizeDate,
  type DateFormatReport,
} from "@/lib/ar-parsers/dates";
import {
  detectColumnDetailed,
  FIELD_CANDIDATES,
  FIELD_RESOLUTION_ORDER,
  MERGE_SENTINEL,
  OPTIONAL_FIELDS,
  REQUIRED_FIELDS,
  type FieldKey,
  type FieldMapping,
} from "@/lib/ar-parsers/detect";
import {
  ArParseError,
  type ParsedClaim,
  type ParserOptions,
  type RowError,
  type StandardCsvResult,
} from "@/lib/ar-parsers/types";
import {
  DEFAULT_STATUS_CATEGORY,
  DEFAULT_STATUS_LABEL,
} from "@/lib/ar-status";
import {
  calculateAgingDays,
  cleanString,
  toDecimalString,
  toInteger,
} from "@/lib/ar-parsers/utils";

/**
 * The single standard AR import format.
 *
 * Columns are detected by similarity rather than exact header text, patient
 * name can be assembled from first/last columns, and dates are normalised to
 * MM/DD/YYYY. Practice.ehrSource is reference only — it does not select a
 * parser.
 */

export { REQUIRED_FIELDS, OPTIONAL_FIELDS } from "@/lib/ar-parsers/detect";

export const TEMPLATE_COLUMNS = [
  ...REQUIRED_FIELDS,
  ...OPTIONAL_FIELDS,
] as const;

/** Abort threshold, and the row count below which it is not applied. */
export const MAX_ERROR_RATE = 0.2;
export const ERROR_RATE_MIN_ROWS = 10;

export interface FieldMappingRow {
  field: string;
  /** Header text found in the file, or null. */
  detectedColumn: string | null;
  columnIndex: number;
  required: boolean;
  found: boolean;
  /** Set when patient_name was assembled from two columns. */
  mergedFrom?: [string, string];
  note?: string;
}

export interface MappingReport {
  headers: string[];
  mappings: FieldMappingRow[];
  missingRequired: string[];
  patientNameMerged: boolean;
  dateFormat: DateFormatReport | null;
  dateNotes: string[];
}

interface ResolvedColumns {
  index: Partial<Record<FieldKey, number>>;
  firstNameIndex: number;
  lastNameIndex: number;
  mergePatientName: boolean;
}

/** First column whose header matches this text exactly, or -1. */
function indexOfHeader(headers: string[], header: string | null): number {
  if (!header) return -1;
  return headers.indexOf(header);
}

/**
 * Turns a PM-confirmed mapping into column indices. No detection runs — the
 * PM's choices are taken literally, including "not mapped".
 */
function resolveFromMapping(
  headers: string[],
  mapping: FieldMapping,
): ResolvedColumns {
  const index: Partial<Record<FieldKey, number>> = {};

  const assign = (field: FieldKey, header: string | null) => {
    const position = indexOfHeader(headers, header);
    if (position !== -1) index[field] = position;
  };

  const mergePatientName = mapping.patient_name === MERGE_SENTINEL;

  if (!mergePatientName) assign("patient_name", mapping.patient_name);

  assign("date_of_service", mapping.date_of_service);
  assign("provider_name", mapping.provider_name);
  assign("insurance_name", mapping.insurance_name);
  assign("billed_amount", mapping.billed_amount);
  assign("balance", mapping.balance);
  assign("cpt_code", mapping.cpt_code);
  assign("claim_number", mapping.claim_number);
  assign("subscriber_id", mapping.subscriber_id);
  assign("patient_id", mapping.patient_id);
  assign("aging_days", mapping.aging_days);

  const firstNameIndex = indexOfHeader(headers, mapping.first_name_col);
  const lastNameIndex = indexOfHeader(headers, mapping.last_name_col);

  return {
    index,
    firstNameIndex,
    lastNameIndex,
    mergePatientName:
      mergePatientName && firstNameIndex !== -1 && lastNameIndex !== -1,
  };
}

function resolveColumns(
  headers: string[],
  mapping?: FieldMapping,
): ResolvedColumns {
  if (mapping) return resolveFromMapping(headers, mapping);

  const index: Partial<Record<FieldKey, number>> = {};
  // Each column belongs to at most one field, so a generic alias cannot steal
  // a column a more specific field already matched.
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

  const patientNameIndex = index.patient_name ?? -1;
  const firstNameIndex = index.first_name ?? -1;
  const lastNameIndex = index.last_name ?? -1;

  // A dedicated patient_name column wins; otherwise first + last are merged.
  const mergePatientName =
    patientNameIndex === -1 && firstNameIndex !== -1 && lastNameIndex !== -1;

  return { index, firstNameIndex, lastNameIndex, mergePatientName };
}

/**
 * Builds the mapping preview shown to the PM before import. Reads only the
 * header row plus a sample of dates, so it is cheap enough to run on upload.
 */
export function buildMappingReport(
  buffer: Buffer,
  mapping?: FieldMapping,
): MappingReport {
  const rows = parseCsv(buffer.toString("utf8"));

  if (rows.length === 0) {
    throw new ArParseError("The CSV file is empty.");
  }

  const headers = rows[0]!.map((header) => header.trim());
  const resolved = resolveColumns(headers, mapping);
  const mappings: FieldMappingRow[] = [];
  const missingRequired: string[] = [];

  for (const field of REQUIRED_FIELDS) {
    if (field === "patient_name" && resolved.mergePatientName) {
      mappings.push({
        field,
        detectedColumn: `${headers[resolved.firstNameIndex]} + ${headers[resolved.lastNameIndex]}`,
        columnIndex: -1,
        required: true,
        found: true,
        mergedFrom: [
          headers[resolved.firstNameIndex]!,
          headers[resolved.lastNameIndex]!,
        ],
        note: "Merged into “First Last”.",
      });
      continue;
    }

    const columnIndex = resolved.index[field as FieldKey] ?? -1;
    const found = columnIndex !== -1;

    if (!found) missingRequired.push(field);

    mappings.push({
      field,
      detectedColumn: found ? headers[columnIndex]! : null,
      columnIndex,
      required: true,
      found,
    });
  }

  for (const field of OPTIONAL_FIELDS) {
    const columnIndex = resolved.index[field as FieldKey] ?? -1;
    mappings.push({
      field,
      detectedColumn: columnIndex === -1 ? null : headers[columnIndex]!,
      columnIndex,
      required: false,
      found: columnIndex !== -1,
      note:
        field === "aging_days" && columnIndex === -1
          ? "Will be calculated from date_of_service."
          : undefined,
    });
  }

  // Sample the date column so the preview can report the detected format.
  let dateFormat: DateFormatReport | null = null;
  let dateNotes: string[] = [];

  const dateIndex = resolved.index.date_of_service ?? -1;

  if (dateIndex !== -1) {
    const samples: string[] = [];
    for (let i = 1; i < rows.length; i += 1) {
      const value = rows[i]?.[dateIndex]?.trim();
      if (value) samples.push(value);
    }
    dateFormat = detectDateFormat(samples);
    dateNotes = describeDateCorrections(dateFormat);
  }

  return {
    headers,
    mappings,
    missingRequired,
    patientNameMerged: resolved.mergePatientName,
    dateFormat,
    dateNotes,
  };
}

export function parseStandardCsv(
  buffer: Buffer,
  options: ParserOptions = {},
): StandardCsvResult {
  const asOf = options.asOfDate ?? new Date();

  const rows = parseCsv(buffer.toString("utf8"));
  const claims: ParsedClaim[] = [];
  const errors: RowError[] = [];
  const warnings: string[] = [];

  if (rows.length === 0) {
    throw new ArParseError("The CSV file is empty.");
  }

  const headers = rows[0]!.map((header) => header.trim());
  const resolved = resolveColumns(headers, options.fieldMapping);

  const missingRequired = REQUIRED_FIELDS.filter((field) => {
    if (field === "patient_name") {
      return resolved.index.patient_name === undefined && !resolved.mergePatientName;
    }
    return resolved.index[field as FieldKey] === undefined;
  });

  if (missingRequired.length > 0) {
    throw new ArParseError(
      `CSV is missing required column${missingRequired.length === 1 ? "" : "s"}: ${missingRequired.join(", ")}. Download the template for the expected format.`,
    );
  }

  // Report what detection resolved, so the PM can see it in the summary.
  for (const field of [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS]) {
    const columnIndex = resolved.index[field as FieldKey] ?? -1;
    if (columnIndex !== -1) {
      const header = headers[columnIndex]!;
      if (header.toLowerCase().replace(/[^a-z0-9]/g, "") !== field.replace(/_/g, "")) {
        warnings.push(`${field}: matched column “${header}”.`);
      }
    }
  }

  if (resolved.mergePatientName) {
    warnings.push(
      `patient_name ← “${headers[resolved.firstNameIndex]}” + “${headers[resolved.lastNameIndex]}”.`,
    );
  }

  for (const field of OPTIONAL_FIELDS) {
    if (resolved.index[field as FieldKey] === undefined) {
      warnings.push(
        `Optional column "${field}" not present — ${
          field === "aging_days"
            ? "aging calculated from date_of_service"
            : "left blank on every claim"
        }.`,
      );
    }
  }

  const dataRows: { row: string[]; rowNumber: number }[] = [];

  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index]!;
    if (isBlankRow(row)) continue; // Blank rows are skipped silently.
    dataRows.push({ row, rowNumber: index + 1 });
  }

  if (dataRows.length === 0) {
    throw new ArParseError("The CSV contains a header row but no data rows.");
  }

  const at = (row: string[], field: FieldKey): string | undefined => {
    const columnIndex = resolved.index[field];
    return columnIndex === undefined ? undefined : cleanString(row[columnIndex]);
  };

  // Decide the date order once, from the whole column.
  const dateIndex = resolved.index.date_of_service!;
  const dateSamples = dataRows
    .map((entry) => entry.row[dateIndex]?.trim())
    .filter((value): value is string => Boolean(value));

  const dateFormat = detectDateFormat(dateSamples);
  warnings.push(...describeDateCorrections(dateFormat));

  for (const { row, rowNumber } of dataRows) {
    const rowErrors: RowError[] = [];

    let patientName: string | undefined;

    if (resolved.mergePatientName) {
      const first = cleanString(row[resolved.firstNameIndex]) ?? "";
      const last = cleanString(row[resolved.lastNameIndex]) ?? "";
      patientName = `${first} ${last}`.trim() || undefined;
    } else {
      patientName = at(row, "patient_name");
    }

    if (!patientName) {
      rowErrors.push({ row: rowNumber, field: "patient_name", message: "Required — value is missing." });
    }

    const providerName = at(row, "provider_name");
    if (!providerName) {
      rowErrors.push({ row: rowNumber, field: "provider_name", message: "Required — value is missing." });
    }

    const insuranceName = at(row, "insurance_name");
    if (!insuranceName) {
      rowErrors.push({ row: rowNumber, field: "insurance_name", message: "Required — value is missing." });
    }

    const rawDate = at(row, "date_of_service");
    let dateOfService: Date | null = null;

    if (!rawDate) {
      rowErrors.push({ row: rowNumber, field: "date_of_service", message: "Required — value is missing." });
    } else {
      const normalized = normalizeDate(rawDate, dateFormat.order);
      if (!normalized) {
        rowErrors.push({
          row: rowNumber,
          field: "date_of_service",
          message: `"${rawDate}" is not a valid date (expected ${dateFormat.description}).`,
        });
      } else {
        dateOfService = normalized.date;
      }
    }

    const rawBilled = at(row, "billed_amount");
    const billedAmount = rawBilled === undefined ? undefined : toDecimalString(rawBilled);

    if (rawBilled === undefined) {
      rowErrors.push({ row: rowNumber, field: "billed_amount", message: "Required — value is missing." });
    } else if (billedAmount === undefined) {
      rowErrors.push({
        row: rowNumber,
        field: "billed_amount",
        message: `"${rawBilled}" is not a valid decimal amount.`,
      });
    }

    const rawBalance = at(row, "balance");
    const balance = rawBalance === undefined ? undefined : toDecimalString(rawBalance);

    if (rawBalance === undefined) {
      rowErrors.push({ row: rowNumber, field: "balance", message: "Required — value is missing." });
    } else if (balance === undefined) {
      rowErrors.push({
        row: rowNumber,
        field: "balance",
        message: `"${rawBalance}" is not a valid decimal amount.`,
      });
    }

    let agingDays: number | undefined;
    const rawAging = at(row, "aging_days");

    if (rawAging !== undefined) {
      const parsed = toInteger(rawAging);
      if (parsed === undefined || parsed < 0) {
        rowErrors.push({
          row: rowNumber,
          field: "aging_days",
          message: `"${rawAging}" is not a valid whole number of days.`,
        });
      } else {
        agingDays = parsed;
      }
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
      continue;
    }

    claims.push({
      patientName: patientName!,
      patientId: at(row, "patient_id"),
      insuranceName: insuranceName!,
      subscriberId: at(row, "subscriber_id"),
      claimNumber: at(row, "claim_number"),
      dateOfService: dateOfService!,
      cptCode: at(row, "cpt_code"),
      billedAmount: billedAmount!,
      balance: balance!,
      agingDays: agingDays ?? calculateAgingDays(dateOfService!, asOf),
      providerName: providerName!,
      statusLabel: DEFAULT_STATUS_LABEL,
      statusCategory: DEFAULT_STATUS_CATEGORY,
    });
  }

  // Count affected rows, not individual field errors — one bad row can raise
  // several errors and must not be double-counted against the threshold.
  const failedRowCount = new Set(errors.map((error) => error.row)).size;

  // Small files are exempt: on a 4-row file a single bad row is 25%, and
  // aborting the whole import over it helps nobody.
  if (
    dataRows.length > ERROR_RATE_MIN_ROWS &&
    failedRowCount / dataRows.length > MAX_ERROR_RATE
  ) {
    throw new ArParseError(
      `Too many invalid rows — please check your CSV format. ${failedRowCount} of ${dataRows.length} rows could not be read.`,
    );
  }

  return { claims, errors, warnings, totalRows: dataRows.length };
}
