import { parseStandardCsv } from "@/lib/ar-parsers/standard-csv";
import {
  ArParseError,
  type ParsedClaim,
  type ParserOptions,
  type StandardCsvResult,
} from "@/lib/ar-parsers/types";

export { ArParseError };
export {
  parseStandardCsv,
  buildMappingReport,
  REQUIRED_FIELDS,
  OPTIONAL_FIELDS,
  TEMPLATE_COLUMNS,
  MAX_ERROR_RATE,
  ERROR_RATE_MIN_ROWS,
  type FieldMappingRow,
  type MappingReport,
} from "@/lib/ar-parsers/standard-csv";
export {
  detectColumn,
  autoFieldMapping,
  missingRequiredFields,
  FIELD_LABELS,
  MERGE_SENTINEL,
  type FieldMapping,
  type RequiredField,
  type OptionalField,
} from "@/lib/ar-parsers/detect";
export type {
  ParsedClaim,
  ParserOptions,
  RowError,
  StandardCsvResult,
} from "@/lib/ar-parsers/types";

export const ACCEPTED_UPLOAD_EXTENSIONS = [".csv"];

/**
 * Parses an uploaded AR report. There is one format now — the standard CSV —
 * so this no longer routes by EHR; Practice.ehrSource is reference only.
 *
 * Returns claims plus per-row errors so the PM can be shown a validation
 * summary. Throws ArParseError when the file is unusable as a whole.
 */
export function parseArFileWithReport(
  buffer: Buffer,
  options: ParserOptions = {},
): StandardCsvResult {
  if (!buffer || buffer.length === 0) {
    throw new ArParseError("The uploaded file is empty.");
  }

  try {
    return parseStandardCsv(buffer, options);
  } catch (cause) {
    if (cause instanceof ArParseError) throw cause;

    throw new ArParseError(
      `The file could not be parsed. ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      cause,
    );
  }
}

/** Claims only — use parseArFileWithReport when you need the error report. */
export async function parseArFile(
  buffer: Buffer,
  options?: ParserOptions,
): Promise<ParsedClaim[]> {
  return parseArFileWithReport(buffer, options ?? {}).claims;
}
