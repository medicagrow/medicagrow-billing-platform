"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { FieldError, Label } from "@/components/ui/Input";
import { Select, Textarea } from "@/components/ui/Select";
import { useToast } from "@/components/ui/toast";
import { announceClaimsChanged } from "@/lib/ar/claims-changed";
import {
  BLUE_STATUSES,
  GREEN_STATUSES,
  RED_STATUSES,
} from "@/lib/ar-status";

/** Below this a note is a shrug, not a reason. Matches the API's rule. */
const MIN_NOTE_LENGTH = 10;

/**
 * Every status, grouped by what it means for the claim. Built from the
 * canonical lists, so a status added there appears here without an edit.
 */
export function StatusSelect({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  return (
    <Select
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
    >
      <option value="">Choose a status…</option>
      <optgroup label="🔴 Red — biller action pending">
        {RED_STATUSES.map((status) => (
          <option key={status} value={status}>
            {status}
          </option>
        ))}
      </optgroup>
      <optgroup label="🔵 Blue — blocked on practice">
        {BLUE_STATUSES.map((status) => (
          <option key={status} value={status}>
            {status}
          </option>
        ))}
      </optgroup>
      <optgroup label="🟢 Green — biller action complete">
        {GREEN_STATUSES.map((status) => (
          <option key={status} value={status}>
            {status}
          </option>
        ))}
      </optgroup>
    </Select>
  );
}

/**
 * A status change and a reason, for one claim or many.
 *
 * What happens on submit depends on who is asking. A manager's change applies
 * at once; a biller's becomes a request a manager approves, because this form
 * skips the structured outcome a full note records and a status is the claim's
 * position in everybody's workflow.
 */
export function QuickUpdateForm({
  claimIds,
  isManager,
  idPrefix,
  onSubmitted,
  onCancel,
}: {
  claimIds: string[];
  isManager: boolean;
  /** Keeps label ids unique when two forms are on screen. */
  idPrefix: string;
  onSubmitted?: () => void;
  onCancel?: () => void;
}) {
  const { toast } = useToast();

  const [statusLabel, setStatusLabel] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = note.trim();
  const noteTooShort = trimmed.length < MIN_NOTE_LENGTH;

  async function submit() {
    setError(null);

    if (!statusLabel) return setError("Choose the new status.");
    if (noteTooShort) {
      return setError(
        `Say what happened — at least ${MIN_NOTE_LENGTH} characters.`,
      );
    }

    setSaving(true);

    try {
      const response = await fetch(
        isManager ? "/api/ar/claims/quick-update" : "/api/ar/status-requests",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ claimIds, statusLabel, note: trimmed }),
        },
      );

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setError(payload?.error ?? "Could not save the update.");
        return;
      }

      if (isManager) {
        toast(
          `Status updated on ${payload.updated} claim${payload.updated === 1 ? "" : "s"}` +
            (payload.superseded > 0
              ? ` · ${payload.superseded} pending request${payload.superseded === 1 ? "" : "s"} superseded`
              : ""),
        );
      } else {
        toast(
          "Update request submitted — awaiting PM approval" +
            (payload.skipped > 0
              ? ` · ${payload.skipped} already pending, skipped`
              : ""),
        );
      }

      setStatusLabel("");
      setNote("");
      announceClaimsChanged();
      onSubmitted?.();
    } catch {
      setError("Could not save the update. Check your connection.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      {error ? <FieldError>{error}</FieldError> : null}

      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-status`}>New status</Label>
        <StatusSelect
          id={`${idPrefix}-status`}
          value={statusLabel}
          onChange={setStatusLabel}
          disabled={saving}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-note`}>Note</Label>
        <Textarea
          id={`${idPrefix}-note`}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={3}
          maxLength={5000}
          disabled={saving}
          placeholder="What happened, and why the status is changing"
        />
        <p
          className={`text-[11px] ${
            trimmed.length > 0 && noteTooShort ? "text-amber-700" : "text-slate-400"
          }`}
        >
          {trimmed.length}/{MIN_NOTE_LENGTH} characters minimum
        </p>
      </div>

      {!isManager ? (
        <p className="text-xs text-slate-500">
          Your project manager approves this before the status changes.
        </p>
      ) : null}

      <div className="flex justify-end gap-2">
        {onCancel ? (
          <Button
            variant="secondary"
            onClick={onCancel}
            disabled={saving}
            className="px-3 py-1.5 text-xs"
          >
            Cancel
          </Button>
        ) : null}
        <Button
          onClick={submit}
          disabled={saving}
          className="px-3 py-1.5 text-xs"
        >
          {saving
            ? "Saving…"
            : isManager
              ? claimIds.length > 1
                ? `Update ${claimIds.length} claims`
                : "Update status"
              : "Submit for approval"}
        </Button>
      </div>
    </div>
  );
}
