"use client";

import type { InputHTMLAttributes } from "react";
import { inputClassName } from "@/components/ui/Input";
import { cn } from "@/lib/utils";

type Props = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type"
> & {
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
};

/**
 * Whole numbers only. Digits are the only accepted character, so no decimal
 * point, sign or separator can be typed — use DecimalInput for money.
 */
export function NumericInput({
  value,
  onChange,
  maxLength = 12,
  className,
  ...props
}: Props) {
  return (
    <input
      {...props}
      type="text"
      inputMode="numeric"
      value={value}
      onChange={(event) =>
        onChange(event.target.value.replace(/\D/g, "").slice(0, maxLength))
      }
      className={cn(inputClassName, "tabular-nums", className)}
    />
  );
}
