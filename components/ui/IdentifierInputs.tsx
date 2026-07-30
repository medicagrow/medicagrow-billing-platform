"use client";

import type { InputHTMLAttributes } from "react";
import { inputClassName } from "@/components/ui/Input";
import { cn } from "@/lib/utils";

/**
 * Formatted identifier fields, matching the credentialing app's conventions.
 * Each holds its display value; the API normalises to digits before storing.
 */

type BaseProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange"
> & {
  value: string;
  onChange: (value: string) => void;
};

const digitsOnly = (value: string) => value.replace(/\D/g, "");

/* --------------------------------- EIN ----------------------------------- */

/** 123456789 -> 12-3456789 */
export function formatEin(value: string) {
  const digits = digitsOnly(value).slice(0, 9);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}-${digits.slice(2)}`;
}

/** Tax ID / EIN — digits only, hyphen auto-inserted after the second digit. */
export function EINInput({ value, onChange, className, ...props }: BaseProps) {
  return (
    <input
      {...props}
      type="text"
      inputMode="numeric"
      placeholder={props.placeholder ?? "12-3456789"}
      value={value}
      onChange={(event) => onChange(formatEin(event.target.value))}
      className={cn(inputClassName, "tabular-nums", className)}
    />
  );
}

/* --------------------------------- NPI ----------------------------------- */

/** NPI — exactly 10 digits, no formatting. */
export function NPIInput({ value, onChange, className, ...props }: BaseProps) {
  return (
    <input
      {...props}
      type="text"
      inputMode="numeric"
      maxLength={10}
      placeholder={props.placeholder ?? "1234567890"}
      value={value}
      onChange={(event) => onChange(digitsOnly(event.target.value).slice(0, 10))}
      className={cn(inputClassName, "tabular-nums", className)}
    />
  );
}

/* --------------------------------- ZIP ----------------------------------- */

/** 123456789 -> 12345-6789; 12345 stays as-is. */
export function formatZip(value: string) {
  const digits = digitsOnly(value).slice(0, 9);
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

export function ZipInput({ value, onChange, className, ...props }: BaseProps) {
  return (
    <input
      {...props}
      type="text"
      inputMode="numeric"
      placeholder={props.placeholder ?? "12345 or 12345-6789"}
      value={value}
      onChange={(event) => onChange(formatZip(event.target.value))}
      className={cn(inputClassName, "tabular-nums", className)}
    />
  );
}

/* -------------------------------- State ---------------------------------- */

/** Two uppercase letters. */
export function StateInput({ value, onChange, className, ...props }: BaseProps) {
  return (
    <input
      {...props}
      type="text"
      maxLength={2}
      placeholder={props.placeholder ?? "CA"}
      value={value}
      onChange={(event) =>
        onChange(
          event.target.value.replace(/[^a-zA-Z]/g, "").toUpperCase().slice(0, 2),
        )
      }
      className={cn(inputClassName, "uppercase", className)}
    />
  );
}

/* ------------------------------- Taxonomy -------------------------------- */

/** Taxonomy code — up to 10 alphanumeric characters, upper-cased. */
export function TaxonomyInput({
  value,
  onChange,
  className,
  ...props
}: BaseProps) {
  return (
    <input
      {...props}
      type="text"
      maxLength={10}
      placeholder={props.placeholder ?? "207Q00000X"}
      value={value}
      onChange={(event) =>
        onChange(
          event.target.value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 10),
        )
      }
      className={cn(inputClassName, "uppercase", className)}
    />
  );
}

/** Alphanumeric identifier with a length cap (PTAN, Medicaid provider #). */
export function AlphanumericInput({
  value,
  onChange,
  maxLength = 15,
  className,
  ...props
}: BaseProps & { maxLength?: number }) {
  return (
    <input
      {...props}
      type="text"
      maxLength={maxLength}
      value={value}
      onChange={(event) =>
        onChange(
          event.target.value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, maxLength),
        )
      }
      className={cn(inputClassName, "uppercase", className)}
    />
  );
}
