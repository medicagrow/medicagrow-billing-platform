import { isValidCalendarDate } from "@/lib/calendar";

/**
 * Date normalisation for the standard CSV import.
 *
 * The canonical stored format is MM/DD/YYYY. Everything else is normalised to
 * it, but the day/month order is decided **once for the whole column** rather
 * than per row. Deciding per row would silently produce a mixed column: in a
 * DD/MM file, 14/03 would be corrected while 03/04 would be read as March 4th,
 * and the resulting aging errors would be invisible.
 */

export type DateOrder = "MDY" | "DMY" | "ISO" | "UNKNOWN";

const ISO_PATTERN = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/;
const SLASH_PATTERN = /^(\d{1,2})[-/](\d{1,2})[-/](\d{2}|\d{4})$/;

/** 00–29 -> 2000–2029, 30–99 -> 1930–1999. */
export function expandTwoDigitYear(year: number): number {
  if (year >= 100) return year;
  return year <= 29 ? 2000 + year : 1900 + year;
}

const pad = (value: number) => String(value).padStart(2, "0");

interface DateParts {
  first: number;
  second: number;
  year: number;
  isIso: boolean;
  hadTwoDigitYear: boolean;
  separator: string;
}

function splitDate(raw: string): DateParts | null {
  const text = raw.trim();

  const iso = ISO_PATTERN.exec(text);
  if (iso) {
    return {
      first: Number(iso[2]),
      second: Number(iso[3]),
      year: Number(iso[1]),
      isIso: true,
      hadTwoDigitYear: false,
      separator: text.includes("-") ? "-" : "/",
    };
  }

  const slash = SLASH_PATTERN.exec(text);
  if (slash) {
    const rawYear = Number(slash[3]);
    return {
      first: Number(slash[1]),
      second: Number(slash[2]),
      year: expandTwoDigitYear(rawYear),
      isIso: false,
      hadTwoDigitYear: slash[3]!.length === 2,
      separator: text.includes("-") ? "-" : "/",
    };
  }

  return null;
}

export interface DateFormatReport {
  order: DateOrder;
  /** Human description for the warnings array. */
  description: string;
  sawTwoDigitYear: boolean;
  sawDashes: boolean;
  sawIso: boolean;
  /** True when the column looks like DD/MM and was flipped. */
  autoDetectedDayFirst: boolean;
}

/**
 * Decides the column's date order from every value in it.
 *
 * A first component above 12 cannot be a month, so it proves the column is
 * day-first. Absent that proof the column is treated as MM/DD/YYYY, the
 * documented format.
 */
export function detectDateFormat(values: string[]): DateFormatReport {
  let sawTwoDigitYear = false;
  let sawDashes = false;
  let sawIso = false;
  let firstOverTwelve = 0;
  let secondOverTwelve = 0;
  let parsable = 0;

  for (const value of values) {
    const parts = splitDate(value);
    if (!parts) continue;

    parsable += 1;
    if (parts.hadTwoDigitYear) sawTwoDigitYear = true;
    if (parts.separator === "-" && !parts.isIso) sawDashes = true;
    if (parts.isIso) sawIso = true;
    if (!parts.isIso) {
      if (parts.first > 12) firstOverTwelve += 1;
      if (parts.second > 12) secondOverTwelve += 1;
    }
  }

  if (parsable === 0) {
    return {
      order: "UNKNOWN",
      description: "no recognisable dates",
      sawTwoDigitYear,
      sawDashes,
      sawIso,
      autoDetectedDayFirst: false,
    };
  }

  if (sawIso && firstOverTwelve === 0 && secondOverTwelve === 0) {
    return {
      order: "ISO",
      description: "YYYY-MM-DD",
      sawTwoDigitYear,
      sawDashes,
      sawIso,
      autoDetectedDayFirst: false,
    };
  }

  // Day-first only when it is proven and never contradicted.
  const dayFirst = firstOverTwelve > 0 && secondOverTwelve === 0;

  return {
    order: dayFirst ? "DMY" : "MDY",
    description: dayFirst ? "DD/MM/YYYY" : "MM/DD/YYYY",
    sawTwoDigitYear,
    sawDashes,
    sawIso,
    autoDetectedDayFirst: dayFirst,
  };
}

export interface NormalizedDate {
  /** Canonical MM/DD/YYYY string. */
  canonical: string;
  /** YYYY-MM-DD, for validation and Date construction. */
  iso: string;
  date: Date;
}

/**
 * Normalises one value using the column's decided order, then validates it as
 * a real calendar date (rejects Feb 30, Feb 29 in a non-leap year, and so on).
 */
export function normalizeDate(
  raw: string,
  order: DateOrder,
): NormalizedDate | null {
  const parts = splitDate(raw);
  if (!parts) return null;

  let month: number;
  let day: number;

  if (parts.isIso) {
    month = parts.first;
    day = parts.second;
  } else if (order === "DMY") {
    day = parts.first;
    month = parts.second;
  } else {
    month = parts.first;
    day = parts.second;
  }

  const iso = `${parts.year}-${pad(month)}-${pad(day)}`;

  if (!isValidCalendarDate(iso)) return null;

  return {
    canonical: `${pad(month)}/${pad(day)}/${parts.year}`,
    iso,
    date: new Date(`${iso}T00:00:00.000Z`),
  };
}

/** Notes describing what the importer auto-corrected, for the warnings list. */
export function describeDateCorrections(report: DateFormatReport): string[] {
  const notes: string[] = [];

  if (report.order === "ISO") {
    notes.push(
      "date_of_service: YYYY-MM-DD detected → converted to MM/DD/YYYY.",
    );
  }

  if (report.autoDetectedDayFirst) {
    notes.push(
      "date_of_service: DD/MM/YYYY detected (a day value above 12 appears in this column) → converted to MM/DD/YYYY. Verify a sample before working these claims.",
    );
  }

  if (report.sawTwoDigitYear) {
    notes.push(
      "date_of_service: 2-digit years expanded (00–29 → 2000s, 30–99 → 1900s).",
    );
  }

  if (report.sawDashes) {
    notes.push("date_of_service: dash separators normalised to slashes.");
  }

  return notes;
}
