"use client";

import { useEffect, useState, type InputHTMLAttributes } from "react";
import { inputClassName } from "@/components/ui/Input";
import { cn } from "@/lib/utils";

type Props = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type"
> & {
  /** Display value, 0–100 as the user sees it. */
  value: string;
  onChange: (value: string) => void;
};

/** Clamps to 0–100 with at most two decimals. */
export function normalisePercentInput(raw: string): string {
  const cleaned = raw.replace(/[^\d.]/g, "");

  // Keep only the first decimal point.
  const [whole = "", ...rest] = cleaned.split(".");
  const fraction = rest.join("").slice(0, 2);
  const joined = rest.length > 0 ? `${whole}.${fraction}` : whole;

  if (joined === "" || joined === ".") return joined;

  const numeric = Number(joined);
  if (!Number.isFinite(numeric)) return "";

  return numeric > 100 ? "100" : joined;
}

/** 0–100 in, 0–1 out. Blank stays blank — it means "no data", not zero. */
export function percentToDecimal(display: string): number | null {
  if (display.trim() === "") return null;
  const numeric = Number(display);
  if (!Number.isFinite(numeric)) return null;
  return Math.min(1, Math.max(0, numeric / 100));
}

/** 0–1 in, 0–100 out for display. */
export function decimalToPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return "";
  return String(Math.round(Number(value) * 10000) / 100);
}

/**
 * Percentage field. The user works in 0–100; the database stores 0–1. The
 * conversion happens at the boundary via percentToDecimal / decimalToPercent
 * so the two representations never get mixed up mid-form.
 */
export function PercentInput({
  value,
  onChange,
  className,
  ...props
}: Props) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  return (
    <div className="relative">
      <input
        {...props}
        type="text"
        inputMode="decimal"
        value={draft}
        onChange={(event) => setDraft(normalisePercentInput(event.target.value))}
        onBlur={(event) => {
          // Tidy up on blur: "12." becomes "12", "" stays empty.
          const tidied =
            draft === "" || draft === "."
              ? ""
              : String(Number(normalisePercentInput(draft)));
          setDraft(tidied);
          onChange(tidied);
          props.onBlur?.(event);
        }}
        className={cn(inputClassName, "pr-8 tabular-nums", className)}
      />
      <span className="pointer-events-none absolute inset-y-0 right-0 flex w-8 items-center justify-center text-sm text-slate-400">
        %
      </span>
    </div>
  );
}
