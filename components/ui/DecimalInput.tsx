"use client";

import type { InputHTMLAttributes } from "react";
import { inputClassName } from "@/components/ui/Input";
import { cn } from "@/lib/utils";

type DecimalInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type" | "prefix"
> & {
  /** Held as a string so precision survives the round trip to Prisma Decimal. */
  value: string;
  onChange: (value: string) => void;
  /**
   * Leading adornment. Defaults to "$" — pass null for decimal quantities that
   * are not money, such as a headcount of 1.5.
   */
  prefix?: string | null;
};

/**
 * Dollar-amount field. Accepts digits and a single decimal point, caps input at
 * two decimal places, and pads to 2dp on blur. The value stays a string end to
 * end — never parse it to a float before it reaches a Prisma Decimal column.
 */
export function DecimalInput({
  value,
  onChange,
  className,
  prefix = "$",
  ...props
}: DecimalInputProps) {
  return (
    <div className="relative">
      {prefix ? (
        <span className="pointer-events-none absolute inset-y-0 left-0 flex w-8 items-center justify-center text-sm text-slate-400">
          {prefix}
        </span>
      ) : null}
      <input
        {...props}
        type="text"
        inputMode="decimal"
        placeholder={props.placeholder ?? "0.00"}
        value={value}
        onChange={(event) => {
          const next = event.target.value;

          // Empty, or digits with at most one point and at most 2 decimals.
          if (next === "" || /^\d*(\.\d{0,2})?$/.test(next)) {
            onChange(next);
          }
        }}
        onBlur={(event) => {
          const current = event.target.value;

          if (current !== "" && current !== ".") {
            const amount = Number(current);
            if (Number.isFinite(amount)) {
              onChange(amount.toFixed(2));
            }
          } else if (current === ".") {
            onChange("");
          }

          props.onBlur?.(event);
        }}
        className={cn(
          inputClassName,
          prefix ? "pl-8" : "",
          "text-right tabular-nums",
          className,
        )}
      />
    </div>
  );
}
