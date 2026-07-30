"use client";

import type { InputHTMLAttributes } from "react";
import { inputClassName } from "@/components/ui/Input";
import { cn } from "@/lib/utils";

type NoSpaceInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange"
> & {
  value: string;
  onChange: (value: string) => void;
};

/**
 * Text field that silently strips whitespace as it is typed or pasted.
 * Use for identifiers that must not contain spaces (usernames, claim numbers,
 * payer IDs). For secrets use SensitiveInput instead.
 */
export function NoSpaceInput({
  value,
  onChange,
  className,
  ...props
}: NoSpaceInputProps) {
  return (
    <input
      {...props}
      value={value}
      onChange={(event) => onChange(event.target.value.replace(/\s/g, ""))}
      className={cn(inputClassName, className)}
    />
  );
}
