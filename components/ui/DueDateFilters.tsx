"use client";

import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/utils";

export type DueQuickFilter = "none" | "today" | "overdue";

/**
 * Due-date range plus the two quick filters, shared by My Tasks and the To Do
 * list so the two cannot drift on what "overdue" means.
 *
 * Today and Overdue are mutually exclusive — they bound the same field in
 * incompatible ways, so selecting one clears the other. Selecting the active
 * one again clears it.
 */
export function DueDateFilters({
  quick,
  onQuickChange,
  from,
  to,
  onFromChange,
  onToChange,
  disabled,
}: {
  quick: DueQuickFilter;
  onQuickChange: (next: DueQuickFilter) => void;
  from: string;
  to: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  disabled?: boolean;
}) {
  const toggle = (value: Exclude<DueQuickFilter, "none">) =>
    onQuickChange(quick === value ? "none" : value);

  return (
    <>
      <button
        type="button"
        onClick={() => toggle("today")}
        disabled={disabled}
        aria-pressed={quick === "today"}
        className={cn(
          "rounded-lg px-3 py-2 text-sm font-medium ring-1 ring-inset",
          quick === "today"
            ? "bg-sky-600 text-white ring-sky-600"
            : "bg-white text-slate-600 ring-slate-300 hover:bg-slate-50",
        )}
      >
        Today
      </button>

      <button
        type="button"
        onClick={() => toggle("overdue")}
        disabled={disabled}
        aria-pressed={quick === "overdue"}
        className={cn(
          "rounded-lg px-3 py-2 text-sm font-medium ring-1 ring-inset",
          quick === "overdue"
            ? "bg-red-600 text-white ring-red-600"
            : "bg-white text-slate-600 ring-slate-300 hover:bg-slate-50",
        )}
      >
        Overdue
      </button>

      {/* A quick filter sets its own bound, so the range inputs would have no
          effect while one is active. */}
      <div
        className={cn(
          "flex items-center gap-1",
          quick !== "none" && "opacity-40",
        )}
      >
        <Input
          type="date"
          value={from}
          onChange={(event) => onFromChange(event.target.value)}
          disabled={disabled || quick !== "none"}
          className="w-auto"
          aria-label="Due from"
        />
        <span className="text-slate-400">→</span>
        <Input
          type="date"
          value={to}
          onChange={(event) => onToChange(event.target.value)}
          disabled={disabled || quick !== "none"}
          className="w-auto"
          aria-label="Due to"
        />
      </div>
    </>
  );
}

/** The query params a quick filter or range implies. */
export function dueDateParams(
  quick: DueQuickFilter,
  from: string,
  to: string,
): Record<string, string> {
  if (quick === "today") return { dueToday: "true" };
  if (quick === "overdue") return { overdue: "true" };

  return {
    ...(from ? { dueDateFrom: from } : {}),
    ...(to ? { dueDateTo: to } : {}),
  };
}
