"use client";

import type { InputHTMLAttributes } from "react";
import { inputClassName } from "@/components/ui/Input";
import { cn } from "@/lib/utils";

type Props = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange"
> & {
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
  uppercase?: boolean;
};

/** Letters and digits only — no spaces, punctuation or symbols. */
export function AlphanumericInput({
  value,
  onChange,
  maxLength = 50,
  uppercase = false,
  className,
  ...props
}: Props) {
  return (
    <input
      {...props}
      type="text"
      maxLength={maxLength}
      value={value}
      onChange={(event) => {
        const cleaned = event.target.value
          .replace(/[^a-zA-Z0-9]/g, "")
          .slice(0, maxLength);
        onChange(uppercase ? cleaned.toUpperCase() : cleaned);
      }}
      className={cn(inputClassName, uppercase && "uppercase", className)}
    />
  );
}
