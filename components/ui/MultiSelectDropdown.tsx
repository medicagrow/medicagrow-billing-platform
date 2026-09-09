"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface MultiSelectOption {
  label: string;
  value: string;
  /**
   * Options sharing a group are listed together under its heading. Only the
   * first option of each group prints one, so the caller controls the order by
   * ordering the options.
   */
  group?: string;
  /**
   * Off-limits under the current state of some other filter — shown, so the
   * person can see it exists and why it is unavailable, rather than
   * disappearing and leaving them wondering where it went.
   */
  disabled?: boolean;
  /** A colour swatch or badge rendered before the label. */
  prefix?: React.ReactNode;
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

  const selectable = options.filter((option) => !option.disabled);

  const allSelected =
    selectable.length > 0 && selected.length === selectable.length;

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
                    allSelected ? [] : selectable.map((option) => option.value),
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

              {options.map((option, index) => {
                // Only the first option of a run prints its heading, so the
                // caller decides grouping by ordering the list.
                const startsGroup =
                  option.group !== undefined &&
                  option.group !== options[index - 1]?.group;

                return (
                  <div key={option.value}>
                    {startsGroup ? (
                      <p className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-slate-400">
                        {option.group}
                      </p>
                    ) : null}

                    <button
                      type="button"
                      role="option"
                      aria-selected={selected.includes(option.value)}
                      aria-disabled={option.disabled}
                      disabled={option.disabled}
                      onClick={() => toggle(option.value)}
                      className={cn(
                        "flex w-full items-center gap-2 px-3 py-2 text-left text-sm",
                        option.disabled
                          ? "cursor-not-allowed text-slate-300"
                          : "text-slate-700 hover:bg-slate-50",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={selected.includes(option.value)}
                        readOnly
                        disabled={option.disabled}
                        tabIndex={-1}
                        className="h-4 w-4 rounded border-slate-300"
                      />
                      {option.prefix}
                      <span className="truncate">{option.label}</span>
                    </button>
                  </div>
                );
              })}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
