"use client";

import { Label } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { usePracticeDefault } from "@/lib/hooks/usePracticeDefault";

/**
 * Practice picker that defers to the global selector.
 *
 * Locked and read-only when a practice is selected in the top bar; a free
 * choice when "All Practices" is active.
 */
export function PracticeField({
  id = "practiceId",
  label = "Practice",
  value,
  onChange,
  practices,
  disabled,
  required = true,
}: {
  id?: string;
  label?: string;
  value: string;
  onChange: (practiceId: string) => void;
  practices: { id: string; name: string }[];
  disabled?: boolean;
  required?: boolean;
}) {
  const { practiceId, practiceName, isLocked } = usePracticeDefault();

  if (isLocked && practiceId) {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={id}>{label}</Label>
        <div
          id={id}
          className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-800 ring-1 ring-inset ring-slate-200"
        >
          <span className="truncate">{practiceName ?? "Selected practice"}</span>
          <span className="shrink-0 text-[11px] text-slate-400">
            Change in top bar
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      >
        <option value="">
          {required ? "Select a practice…" : "General (no practice)"}
        </option>
        {practices.map((practice) => (
          <option key={practice.id} value={practice.id}>
            {practice.name}
          </option>
        ))}
      </Select>
    </div>
  );
}
