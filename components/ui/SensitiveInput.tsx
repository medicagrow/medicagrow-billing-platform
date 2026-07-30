"use client";

import { useId, useState, type InputHTMLAttributes } from "react";
import { inputClassName } from "@/components/ui/Input";
import { EyeIcon, EyeOffIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

type SensitiveInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type"
> & {
  value: string;
  onChange: (value: string) => void;
};

/**
 * Password-style field for secrets (passwords, API keys, EHR credentials).
 * Spaces are stripped — see the no-spaces-in-passwords convention — and the
 * value can be revealed with the eye toggle.
 */
export function SensitiveInput({
  value,
  onChange,
  className,
  ...props
}: SensitiveInputProps) {
  const [revealed, setRevealed] = useState(false);
  const generatedId = useId();
  const inputId = props.id ?? generatedId;

  return (
    <div className="relative">
      <input
        {...props}
        id={inputId}
        type={revealed ? "text" : "password"}
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/\s/g, ""))}
        onKeyDown={(event) => {
          // Belt and braces: never let a space reach the value at all.
          if (event.key === " ") {
            event.preventDefault();
          }
          props.onKeyDown?.(event);
        }}
        onPaste={(event) => {
          const pasted = event.clipboardData.getData("text");
          if (/\s/.test(pasted)) {
            event.preventDefault();
            onChange(`${value}${pasted.replace(/\s/g, "")}`);
          }
          props.onPaste?.(event);
        }}
        className={cn(inputClassName, "pr-10", className)}
      />
      <button
        type="button"
        onClick={() => setRevealed((current) => !current)}
        tabIndex={-1}
        aria-label={revealed ? "Hide value" : "Show value"}
        aria-controls={inputId}
        aria-pressed={revealed}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg text-slate-400 transition-colors hover:text-slate-700"
      >
        {revealed ? (
          <EyeOffIcon className="h-[18px] w-[18px]" />
        ) : (
          <EyeIcon className="h-[18px] w-[18px]" />
        )}
      </button>
    </div>
  );
}
