import { forwardRef, type SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className, children, ...props }, ref) {
  return (
    <select
      ref={ref}
      className={cn(
        "block w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-slate-900",
        "shadow-sm ring-1 ring-inset ring-slate-300",
        "focus:ring-2 focus:ring-inset focus:ring-brand-600",
        "disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
});

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      rows={3}
      className={cn(
        "block w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-slate-900",
        "shadow-sm ring-1 ring-inset ring-slate-300 placeholder:text-slate-400",
        "focus:ring-2 focus:ring-inset focus:ring-brand-600",
        className,
      )}
      {...props}
    />
  );
}
