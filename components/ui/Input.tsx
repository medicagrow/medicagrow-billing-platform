import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * Shared field styling. The specialised inputs (PhoneInput, SensitiveInput,
 * NoSpaceInput, DecimalInput) build on this so every field looks identical.
 */
export const inputClassName = cn(
  "block w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-slate-900",
  "shadow-sm ring-1 ring-inset ring-slate-300 placeholder:text-slate-400",
  "focus:ring-2 focus:ring-inset focus:ring-brand-600",
  "disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500",
);

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(inputClassName, className)} {...props} />;
}

export function Label({
  htmlFor,
  children,
}: {
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="block text-sm font-medium text-slate-700"
    >
      {children}
    </label>
  );
}

export function FieldError({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return <p className="text-xs text-red-600">{children}</p>;
}
