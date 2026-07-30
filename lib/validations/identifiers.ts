import { z } from "zod";

/**
 * Identifier field rules, shared by the practice profile and provider roster.
 * Each normalises to storage form (digits only where applicable) so the same
 * value never lands in the database in two different shapes.
 */

const stripToDigits = (value: string) => value.replace(/\D/g, "");
const identity = (value: string) => value;

/**
 * Optional field: empty string, null and undefined all mean "not provided" and
 * normalise to null. A present value must satisfy `isValid` once normalised.
 */
function optionalField(
  normalize: (value: string) => string,
  isValid: (value: string) => boolean,
  message: string,
) {
  return (
    z
      .union([z.string(), z.null(), z.undefined()])
      .transform((value) => (value ?? "").trim())
      .refine((value) => value === "" || isValid(normalize(value)), message)
      .transform((value) => (value === "" ? null : normalize(value)))
      // A transform pipeline hides the fact that undefined is acceptable, so
      // Zod would treat an absent key as missing. This makes omission legal.
      .optional()
      .transform((value) => value ?? null)
  );
}

/** EIN — 9 digits, stored digits-only, displayed XX-XXXXXXX. */
export const einSchema = optionalField(
  stripToDigits,
  (digits) => digits.length === 9,
  "Tax ID must be 9 digits",
);

/** NPI — exactly 10 digits. */
export const npiSchema = optionalField(
  stripToDigits,
  (digits) => digits.length === 10,
  "NPI must be exactly 10 digits",
);

/** NPI on the provider roster, where it is mandatory. */
export const requiredNpiSchema = z
  .string()
  .transform(stripToDigits)
  .refine((digits) => digits.length === 10, "NPI must be exactly 10 digits");

/** ZIP — 5 or 9 digits, stored digits-only. */
export const zipSchema = optionalField(
  stripToDigits,
  (digits) => digits.length === 5 || digits.length === 9,
  "ZIP must be 5 digits, or 9 for ZIP+4",
);

/** Two-letter state code. */
export const stateSchema = optionalField(
  (value) => value.toUpperCase(),
  (value) => /^[A-Z]{2}$/.test(value),
  "State must be a 2-letter code",
);

export const taxonomySchema = optionalField(
  (value) => value.toUpperCase(),
  (value) => /^[A-Z0-9]{1,10}$/.test(value),
  "Taxonomy must be up to 10 letters or digits",
);

export const alphanumericSchema = (max: number, label: string) =>
  optionalField(
    (value) => value.toUpperCase(),
    (value) => new RegExp(`^[A-Z0-9]{1,${max}}$`).test(value),
    `${label} must be up to ${max} letters or digits`,
  );

/** Optional phone — normalised to 10 digits. */
export const optionalPhoneSchema = optionalField(
  (value) => {
    const digits = stripToDigits(value);
    return digits.length === 11 && digits.startsWith("1")
      ? digits.slice(1)
      : digits;
  },
  (digits) => digits.length === 10,
  "Enter a 10-digit US phone number",
);

export const optionalEmailSchema = optionalField(
  (value) => value.toLowerCase(),
  (value) => z.email().safeParse(value).success,
  "Enter a valid email address",
);

/** Free-text field that may be blank. */
export const optionalTextSchema = (max: number) =>
  optionalField(
    (value) => value.slice(0, max),
    () => true,
    "",
  );

export { identity };

/* ------------------------------- display ---------------------------------- */

export function displayEin(value: string | null | undefined) {
  if (!value) return "";
  const digits = stripToDigits(value);
  return digits.length === 9 ? `${digits.slice(0, 2)}-${digits.slice(2)}` : digits;
}

export function displayZip(value: string | null | undefined) {
  if (!value) return "";
  const digits = stripToDigits(value);
  return digits.length === 9 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
}

export function displayPhone(value: string | null | undefined) {
  if (!value) return "";
  const digits = stripToDigits(value);
  return digits.length === 10
    ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
    : digits;
}
