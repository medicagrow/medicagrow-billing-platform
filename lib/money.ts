/**
 * Exact money arithmetic on decimal strings.
 *
 * Aggregating balances with `Number(...)` would put money through a float,
 * which CONVENTIONS.md §3 forbids. These helpers convert to integer cents via
 * BigInt, so summing thousands of claim balances stays exact.
 */

/** "1234.5" | "-40" | "1,234.50" -> 123450n cents. */
export function toCents(value: string | number | null | undefined): bigint {
  if (value === null || value === undefined) return 0n;

  let text = String(value).trim().replace(/[$,\s]/g, "");
  if (text === "" || text === "-") return 0n;

  let negative = false;

  if (text.startsWith("-")) {
    negative = true;
    text = text.slice(1);
  } else if (text.startsWith("+")) {
    text = text.slice(1);
  }

  if (!/^\d*\.?\d*$/.test(text)) return 0n;

  const [whole = "0", fraction = ""] = text.split(".");
  // Round the third decimal rather than truncating it away.
  const cents =
    BigInt(whole === "" ? "0" : whole) * 100n +
    BigInt(`${fraction}00`.slice(0, 2) || "0") +
    (Number(fraction[2] ?? "0") >= 5 ? 1n : 0n);

  return negative ? -cents : cents;
}

/** 123450n -> "1234.50" */
export function centsToDecimalString(cents: bigint): string {
  const negative = cents < 0n;
  const absolute = negative ? -cents : cents;
  const whole = absolute / 100n;
  const fraction = absolute % 100n;

  return `${negative ? "-" : ""}${whole}.${String(fraction).padStart(2, "0")}`;
}

export function sumCents(values: (string | number | null | undefined)[]): bigint {
  return values.reduce<bigint>((running, value) => running + toCents(value), 0n);
}
