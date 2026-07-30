"use client";

import { useState, type InputHTMLAttributes } from "react";
import { inputClassName } from "@/components/ui/Input";
import { cn } from "@/lib/utils";

type Props = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type"
> & {
  value: string;
  onChange: (value: string) => void;
  /** Blank is allowed on optional fields; only a partial code is an error. */
  required?: boolean;
};

export const CPT_LENGTH = 5;

export function isValidCpt(value: string): boolean {
  return /^[A-Z0-9]{5}$/.test(value);
}

/**
 * CPT/HCPCS code — exactly five alphanumeric characters, upper-cased.
 * Validated on blur so a partially typed code does not flag mid-entry.
 */
export function CptInput({
  value,
  onChange,
  required = false,
  className,
  ...props
}: Props) {
  const [touched, setTouched] = useState(false);

  const invalid =
    touched &&
    ((value.length > 0 && !isValidCpt(value)) ||
      (required && value.length === 0));

  return (
    <div>
      <input
        {...props}
        type="text"
        maxLength={CPT_LENGTH}
        value={value}
        onChange={(event) =>
          onChange(
            event.target.value
              .replace(/[^a-zA-Z0-9]/g, "")
              .toUpperCase()
              .slice(0, CPT_LENGTH),
          )
        }
        onBlur={(event) => {
          setTouched(true);
          props.onBlur?.(event);
        }}
        placeholder={props.placeholder ?? "99213"}
        className={cn(
          inputClassName,
          "uppercase tabular-nums",
          invalid && "ring-red-300 focus:ring-red-500",
          className,
        )}
      />
      {invalid ? (
        <p className="mt-1 text-xs text-red-600">
          {value.length === 0
            ? "A CPT code is required."
            : `CPT must be exactly ${CPT_LENGTH} characters.`}
        </p>
      ) : null}
    </div>
  );
}
