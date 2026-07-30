"use client";

import type { InputHTMLAttributes } from "react";
import { inputClassName } from "@/components/ui/Input";
import { formatPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";

/**
 * `formatPhone` and `phoneDigits` live in [lib/phone.ts](../../lib/phone.ts),
 * not here, and are deliberately **not re-exported**. Re-exporting them would
 * let a server component import them across the client boundary, where they
 * arrive as client references rather than functions and throw when called.
 */

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
