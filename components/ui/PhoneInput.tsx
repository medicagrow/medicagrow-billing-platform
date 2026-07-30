"use client";

import type { InputHTMLAttributes } from "react";
import { inputClassName } from "@/components/ui/Input";
import { cn } from "@/lib/utils";

/** Digits only, max 10 (US NANP, leading country code dropped). */
export function phoneDigits(raw: string) {
  const digits = raw.replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("1")
    ? digits.slice(1)
    : digits;
  return national.slice(0, 10);
}

/** 8004562583 -> 800-456-2583 */
export function formatPhone(raw: string) {
  const digits = phoneDigits(raw);

  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

type PhoneInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type"
> & {
  value: string;
  /** Receives the formatted display value, e.g. "800-456-2583". */
  onChange: (value: string) => void;
};

/**
 * US phone field. Non-numeric characters other than dashes and parentheses are
 * rejected outright; the value is then re-formatted from its digits.
 */
export function PhoneInput({
  value,
  onChange,
  className,
  ...props
}: PhoneInputProps) {
  return (
    <input
      {...props}
      type="tel"
      inputMode="tel"
      autoComplete="tel"
      placeholder={props.placeholder ?? "800-456-2583"}
      value={value}
      onChange={(event) => {
        const next = event.target.value;

        // Blocked: anything that is not a digit, dash, parenthesis, space or +.
        if (next !== "" && !/^[\d\s().+-]*$/.test(next)) {
          return;
        }

        onChange(formatPhone(next));
      }}
      className={cn(inputClassName, className)}
    />
  );
}
