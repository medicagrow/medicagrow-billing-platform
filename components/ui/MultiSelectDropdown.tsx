"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface MultiSelectOption {
  label: string;
  value: string;
}

/**
 * A dropdown that filters on several values at once.
 *
 * Selecting nothing means "no filter" rather than "match nothing" — an empty
 * selection is how a filter bar starts, and returning zero rows for an
 * untouched control would read as a bug.
 */
export function MultiSelectDropdown({
  options,
  selected,
  onChange,
  placeholder = "All",
  allLabel = "All",
  noun,
  className,
  disabled,
  "aria-label": ariaLabel,
}: {
  options: MultiSelectOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  /** Label on the select-all row, e.g. "All Insurances". */
  allLabel?: string;
  /** Pluralised in the summary: "3 insurances selected". */
  noun?: string;
  className?: string;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Clicking away closes it; so does Escape, since a dropdown that traps focus
  // in a filter bar is worse than one that closes too eagerly.
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const allSelected = options.length > 0 && selected.length === options.length;

  const summary =
    selected.length === 0 || allSelected
      ? placeholder
      : selected.length === 1
        ? (options.find((option) => option.value === selected[0])?.label ??
          selected[0])
        : `${selected.length} ${noun ?? "selected"}${noun ? " selected" : ""}`;

  function toggle(value: string) {
    onChange(
      selected.includes(value)
        ? selected.filter((entry) => entry !== value)
        : [...selected, value],
    );
  }

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-sm shadow-sm",
          "focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500",
          "disabled:bg-slate-50 disabled:text-slate-400",
        )}
      >
        <span
          className={cn(
            "truncate",
            selected.length === 0 || allSelected
              ? "text-slate-500"
              : "text-slate-900",
          )}
        >
          {summary}
        </span>
        <span className="shrink-0 text-slate-400">▾</span>
      </button>

      {open ? (
        <div
          role="listbox"
          aria-multiselectable
          className="absolute z-30 mt-1 max-h-64 w-full min-w-[200px] overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
        >
          {options.length === 0 ? (
            <p className="px-3 py-2 text-sm text-slate-500">
              Nothing to choose from.
            </p>
          ) : (
            <>
              <button
                type="button"
                onClick={() =>
                  onChange(
                    allSelected ? [] : options.map((option) => option.value),
                  )
                }
                className="flex w-full items-center gap-2 border-b border-slate-100 px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  checked={allSelected}
                  readOnly
                  tabIndex={-1}
                  className="h-4 w-4 rounded border-slate-300"
                />
                {allSelected ? `Deselect all` : allLabel}
              </button>

              {options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={selected.includes(option.value)}
                  onClick={() => toggle(option.value)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(option.value)}
                    readOnly
                    tabIndex={-1}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  <span className="truncate">{option.label}</span>
                </button>
              ))}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
