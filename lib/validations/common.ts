import { z } from "zod";

/**
 * Reusable field schemas. Feature schemas compose these — never redefine a
 * phone, email, date or money rule locally.
 */

/* ---------------------------------- text --------------------------------- */

export const noSpaceStringSchema = z
  .string()
  .trim()
  .min(1, "Required")
  .refine((value) => !/\s/.test(value), "Spaces are not allowed");

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("Enter a valid email address"));

/* --------------------------------- phone --------------------------------- */

const PHONE_ALLOWED_CHARS = /^[\d\s().+-]+$/;

/** Accepts 800-456-2583, (800) 456-2583, 8004562583, +1 800 456 2583. */
export const phoneSchema = z
  .string()
  .trim()
  .refine(
    (value) => PHONE_ALLOWED_CHARS.test(value),
    "Phone number contains invalid characters",
  )
  .transform((value) => {
    const digits = value.replace(/\D/g, "");
    return digits.length === 11 && digits.startsWith("1")
      ? digits.slice(1)
      : digits;
  })
  .refine((digits) => digits.length === 10, "Enter a 10-digit US phone number")
  .refine(
    // NANP: area code and exchange code both start 2-9.
    (digits) => digits[0] !== "0" && digits[0] !== "1" && digits[3] !== "0" && digits[3] !== "1",
    "Enter a valid US phone number",
  );

/* ---------------------------------- date --------------------------------- */

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

// Defined in lib/calendar.ts so client components can use them without Zod.
// Imported as well as re-exported, since the schemas below reference it.
import { isValidCalendarDate } from "@/lib/calendar";

export { daysInMonth, isLeapYear, isValidCalendarDate } from "@/lib/calendar";

/** YYYY-MM-DD in, UTC-midnight Date out. */
export const dateSchema = z
  .string()
  .trim()
  .refine((value) => DATE_PATTERN.test(value), "Use the format YYYY-MM-DD")
  .refine(isValidCalendarDate, "That date does not exist on the calendar")
  .transform((value) => new Date(`${value}T00:00:00.000Z`));

/** Same validation, but keeps the YYYY-MM-DD string. */
export const dateStringSchema = z
  .string()
  .trim()
  .refine((value) => DATE_PATTERN.test(value), "Use the format YYYY-MM-DD")
  .refine(isValidCalendarDate, "That date does not exist on the calendar");

/* --------------------------------- money --------------------------------- */

const MONEY_PATTERN = /^\d+(\.\d{1,2})?$/;

/**
 * Monetary amounts stay strings so they can be handed to a Prisma Decimal
 * column without ever passing through a float.
 */
const baseMoneySchema = z
  .union([z.string(), z.number()])
  .transform((value) =>
    typeof value === "number" ? value.toString() : value.trim(),
  )
  .refine(
    (value) => MONEY_PATTERN.test(value),
    "Enter an amount with at most 2 decimal places",
  );

/** Amount greater than zero. */
export const decimalSchema = baseMoneySchema.refine(
  (value) => Number(value) > 0,
  "Amount must be greater than zero",
);

/** Amount of zero or more — for write-offs, adjustments and zero payments. */
export const nonNegativeDecimalSchema = baseMoneySchema;

/* ------------------------------- credentials ------------------------------ */

/** Passwords must not contain spaces — see CONVENTIONS.md. */
export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(72, "Password must be 72 characters or fewer")
  .refine((value) => !/\s/.test(value), "Password cannot contain spaces");
