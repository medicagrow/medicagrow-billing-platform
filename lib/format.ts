/** Anything Prisma Decimal-ish: a Decimal instance, a string, or a number. */
type MoneyLike = { toString(): string } | string | number | null | undefined;

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Every amount shown to a user goes through this. Takes a Prisma Decimal,
 * string or number and renders "$1,234.50".
 */
export function formatUSD(value: MoneyLike, fallback = "—") {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  const amount = Number(value.toString());

  if (!Number.isFinite(amount)) {
    return fallback;
  }

  return usdFormatter.format(amount);
}

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "2-digit",
  timeZone: "UTC",
});

export function formatDate(value: Date | string | null | undefined) {
  if (!value) return "—";

  const date = value instanceof Date ? value : new Date(value);

  return Number.isNaN(date.getTime()) ? "—" : dateFormatter.format(date);
}
