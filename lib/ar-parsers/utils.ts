/* ------------------------------- strings --------------------------------- */

/** Collapses internal whitespace runs and trims; blank becomes undefined. */
export function cleanString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;

  const text = String(value).replace(/\s+/g, " ").trim();
  return text === "" ? undefined : text;
}

/** Normalises a header for matching: "Patient Name" -> "patientname". */
export function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/* -------------------------------- money ---------------------------------- */

/**
 * Parses a cell into a Decimal-safe 2dp string without ever going through a
 * float. Tolerates "$1,234.50" and "(123.45)" accounting negatives so a file
 * that kept its source formatting still imports.
 */
export function toDecimalString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;

  if (typeof value === "number") {
    return Number.isFinite(value) ? value.toFixed(2) : undefined;
  }

  let text = String(value).trim();
  if (text === "" || text === "-") return undefined;

  let negative = false;

  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }

  text = text.replace(/[$,\s]/g, "");

  if (text.startsWith("-")) {
    negative = true;
    text = text.slice(1);
  } else if (text.startsWith("+")) {
    text = text.slice(1);
  }

  if (!/^\d*\.?\d*$/.test(text) || text === "" || text === ".") {
    return undefined;
  }

  const [wholePart = "0", fractionPart = ""] = text.split(".");
  const whole = wholePart.replace(/^0+(?=\d)/, "") || "0";
  const fraction = `${fractionPart}00`.slice(0, 2);

  if (whole === "0" && Number(fraction) === 0) {
    return "0.00";
  }

  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

/* --------------------------------- dates --------------------------------- */

/** Whole days between DOS and the as-of date. Never negative. */
export function calculateAgingDays(dateOfService: Date, asOf: Date): number {
  const asOfUtc = Date.UTC(
    asOf.getUTCFullYear(),
    asOf.getUTCMonth(),
    asOf.getUTCDate(),
  );
  const days = Math.floor((asOfUtc - dateOfService.getTime()) / 86_400_000);
  return days > 0 ? days : 0;
}

export function toInteger(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;

  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.trunc(value) : undefined;
  }

  const text = String(value).replace(/[,\s]/g, "").trim();
  if (!/^[+-]?\d+(\.\d+)?$/.test(text)) return undefined;

  return Math.trunc(Number(text));
}
