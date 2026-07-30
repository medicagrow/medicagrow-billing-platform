/**
 * US phone number helpers.
 *
 * Deliberately **free of React and of "use client"**, so server components can
 * call them. Exports of a "use client" module become client-reference proxies
 * when a server component imports them — a React component survives that, a
 * plain function does not, and calling it server-side throws
 * "formatPhone is not a function".
 *
 * [components/ui/PhoneInput.tsx](../components/ui/PhoneInput.tsx) imports from
 * here; nothing imports these from there.
 */

/** Digits only, max 10 (US NANP, leading country code dropped). */
export function phoneDigits(raw: string): string {
  const digits = raw.replace(/\D/g, "");

  const national =
    digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;

  return national.slice(0, 10);
}

/** 8004562583 -> 800-456-2583 */
export function formatPhone(raw: string): string {
  const digits = phoneDigits(raw);

  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;

  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}
