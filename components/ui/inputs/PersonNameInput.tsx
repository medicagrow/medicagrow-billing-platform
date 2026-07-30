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
};

/**
 * Patient/person name. Strips characters that never appear in a real name,
 * while keeping the ones that do — O'Brien, Smith-Jones, María all survive.
 * Letters (including accented), spaces, hyphens, apostrophes and periods.
 */
export function PersonNameInput({
  value,
  onChange,
  className,
  ...props
}: Props) {
  return (
    <input
      {...props}
      type="text"
      value={value}
      onChange={(event) =>
        onChange(
          event.target.value.replace(/[^\p{L}\s'\-.,]/gu, "").slice(0, 150),
        )
      }
      className={cn(inputClassName, className)}
    />
  );
}
