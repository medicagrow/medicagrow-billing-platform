import type { StatusCategory } from "@/lib/generated/prisma/enums";
import type { FieldMapping } from "@/lib/ar-parsers/detect";

/**
 * The normalised shape the standard CSV parser produces. Monetary fields are
 * Decimal-safe strings — see CONVENTIONS.md §3, money never becomes a float.
 */
export interface ParsedClaim {
  patientName: string;
  patientId?: string;
  insuranceName: string;
  subscriberId?: string;
  claimNumber?: string;
  dateOfService: Date;
  cptCode?: string;
  billedAmount?: string;
  insurancePaid?: string;
  patientPaid?: string;
  balance: string;
  agingDays: number;
  providerName?: string;
  billingProvider?: string;
  renderingProvider?: string;
  location?: string;
  ehrClaimStatus?: string;
  ehrTags?: string;
  /** Optional visit identifiers some EHRs carry. Reference only. */
  visitId?: string;
  visitStatus?: string;
  /** Every standard-CSV claim imports as Pending / RED. */
  statusLabel?: string;
  statusCategory?: StatusCategory;
}

/** A single field-level problem on one CSV row. */
export interface RowError {
  /** 1-based row number in the source file, counting the header as row 1. */
  row: number;
  field: string;
  message: string;
}

export interface StandardCsvResult {
  claims: ParsedClaim[];
  errors: RowError[];
  warnings: string[];
  /** Non-blank data rows seen, i.e. claims + failed rows. */
  totalRows: number;
}

export interface ParserOptions {
  /** Aging is measured against this date. Defaults to today. */
  asOfDate?: Date;
  /**
   * PM-confirmed column mapping. When present it is used verbatim and no
   * auto-detection runs, so what the PM saw in the preview is what imports.
   */
  fieldMapping?: FieldMapping;
}

export class ArParseError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "ArParseError";
  }
}
