"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, PencilIcon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/format";

/** Days until the target date, measured in whole UTC days. */
function daysUntil(iso: string): number {
  const now = new Date();
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  return Math.round((new Date(iso).getTime() - today) / 86_400_000);
}

type Urgency = "overdue" | "imminent" | "normal";

function urgencyOf(iso: string | null): Urgency {
  if (!iso) return "normal";
  const days = daysUntil(iso);
  if (days < 0) return "overdue";
  if (days <= 1) return "imminent";
  return "normal";
}

export function TargetDateEditor({
  batchId,
  value,
  canEdit,
}: {
  batchId: string;
  value: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ? value.slice(0, 10) : "");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Escape must restore what was showing when editing began, not the last save.
  const restoreTo = useRef(draft);

  useEffect(() => {
    setDraft(value ? value.slice(0, 10) : "");
  }, [value]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const urgency = urgencyOf(value);

  async function save(next: string) {
    const normalized = next === "" ? null : next;
    const current = value ? value.slice(0, 10) : null;

    if (normalized === current) {
      setEditing(false);
      return;
    }

    setSaving(true);

    try {
      const response = await fetch(`/api/ar/batches/${batchId}/target-date`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetCompletionDate: normalized }),
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        toast(payload?.error ?? "Could not save the target date.", "error");
        setDraft(restoreTo.current);
        return;
      }

      toast(normalized ? "Target date set" : "Target date cleared");
      setEditing(false);
      router.refresh();
    } catch {
      toast("Could not save the target date.", "error");
      setDraft(restoreTo.current);
    } finally {
      setSaving(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      setDraft(restoreTo.current);
      setEditing(false);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      save(draft);
    }
  }

  function startEditing() {
    restoreTo.current = value ? value.slice(0, 10) : "";
    setDraft(restoreTo.current);
    setEditing(true);
  }

  if (!canEdit) {
    return (
      <p
        className={`mt-0.5 text-lg font-semibold tabular-nums ${
          urgency === "overdue"
            ? "text-amber-700"
            : urgency === "imminent"
              ? "text-red-700"
              : "text-slate-900"
        }`}
      >
        {value ? formatDate(value) : "—"}
      </p>
    );
  }

  if (editing) {
    return (
      <div className="mt-0.5 flex items-center gap-1">
        <input
          ref={inputRef}
          type="date"
          value={draft}
          disabled={saving}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={(event) => {
            // Blurring onto the confirm button must not cancel the edit.
            if (event.relatedTarget?.getAttribute("data-confirm") === "true") {
              return;
            }
            save(draft);
          }}
          className="w-[150px] rounded-md border-0 px-2 py-1 text-sm text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-inset focus:ring-brand-600"
        />
        <button
          type="button"
          data-confirm="true"
          onClick={() => save(draft)}
          disabled={saving}
          title="Save target date"
          aria-label="Save target date"
          className="rounded-md p-1 text-brand-700 hover:bg-brand-50"
        >
          <CheckIcon className="h-4 w-4" />
        </button>
      </div>
    );
  }

  if (!value) {
    return (
      <button
        type="button"
        onClick={startEditing}
        className="mt-0.5 text-sm font-medium text-brand-700 hover:text-brand-800"
      >
        Set target date
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={startEditing}
      title="Edit target date"
      className="group mt-0.5 flex items-center gap-1.5"
    >
      <span
        className={`text-lg font-semibold tabular-nums ${
          urgency === "overdue"
            ? "text-amber-700"
            : urgency === "imminent"
              ? "text-red-700"
              : "text-slate-900"
        }`}
      >
        {formatDate(value)}
      </span>
      {urgency === "imminent" ? (
        <span
          className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700"
          title="Due today or tomorrow"
        >
          {daysUntil(value) <= 0 ? "TODAY" : "TOMORROW"}
        </span>
      ) : null}
      <PencilIcon className="h-3.5 w-3.5 text-slate-300 group-hover:text-slate-600" />
    </button>
  );
}
