"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { FieldError, Label } from "@/components/ui/Input";
import { Select, Textarea } from "@/components/ui/Select";
import { SpinnerIcon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import {
  ALL_EOB_STATUSES,
  eobStatusToCategory,
  isResolvingStatus,
} from "@/lib/eob-status";

export function EobNoteForm({
  entryId,
  currentStatus,
  assignees,
  canReassign,
  projectManagerName,
  hasPrimaryPm = false,
  disabled,
  disabledReason,
}: {
  entryId: string;
  currentStatus: string;
  assignees: { id: string; name: string }[];
  canReassign: boolean;
  /** Who the escalation chain resolves to right now — not always a PM. */
  projectManagerName: string;
  /** False when the practice has no primary PM and the chain falls through. */
  hasPrimaryPm?: boolean;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [note, setNote] = useState("");
  const [statusLabel, setStatusLabel] = useState(currentStatus);
  const [assignedToChangedId, setAssignedToChangedId] = useState("");
  const [resolutionNote, setResolutionNote] = useState("");
  const [reassignToPm, setReassignToPm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const category = eobStatusToCategory(statusLabel);
  const goesBlue = category === "BLUE";
  const resolving = isResolvingStatus(statusLabel);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!note.trim()) {
      setError("Enter a note describing what you did.");
      return;
    }

    setSaving(true);

    try {
      const response = await fetch("/api/eob/work-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entryId,
          note: note.trim(),
          statusChangedTo: statusLabel,
          assignedToChangedId: assignedToChangedId || undefined,
          resolutionNote: resolving ? resolutionNote.trim() || undefined : undefined,
          reassignToPm,
        }),
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setError(payload?.error ?? "Could not save the note.");
        return;
      }

      toast("Note saved");
      if (payload.reassignedTo) {
        toast(`Entry reassigned to ${payload.reassignedTo}`, "info");
      }
      if (payload.resolved) {
        toast("Entry marked resolved", "info");
      }

      setNote("");
      setResolutionNote("");
      setAssignedToChangedId("");
      setReassignToPm(false);
      router.refresh();
    } catch {
      setError("Could not save the note. Check your connection.");
    } finally {
      setSaving(false);
    }
  }

  if (disabled) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center">
        <p className="text-sm font-medium text-slate-600">
          Notes cannot be added
        </p>
        <p className="mt-1 text-xs text-slate-500">{disabledReason}</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="eobNote">What did you do?</Label>
        <Textarea
          id="eobNote"
          rows={4}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Called payer, confirmed auth on file, resubmitting with corrected modifier…"
          disabled={saving}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="eobStatus">New status</Label>
          <Select
            id="eobStatus"
            value={statusLabel}
            onChange={(event) => setStatusLabel(event.target.value)}
            disabled={saving}
          >
            {ALL_EOB_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </Select>
        </div>

        {canReassign ? (
          <div className="space-y-1.5">
            <Label htmlFor="eobAssign">Reassign (optional)</Label>
            <Select
              id="eobAssign"
              value={assignedToChangedId}
              onChange={(event) => setAssignedToChangedId(event.target.value)}
              disabled={saving || goesBlue || reassignToPm}
            >
              <option value="">Leave as is</option>
              {assignees.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
      </div>

      {resolving ? (
        <div className="space-y-1.5">
          <Label htmlFor="eobResolution">Resolution details (optional)</Label>
          <Textarea
            id="eobResolution"
            rows={2}
            value={resolutionNote}
            onChange={(event) => setResolutionNote(event.target.value)}
            placeholder="Corrected CPT and resubmitted on 07/29 — new claim #12345."
            disabled={saving}
          />
          <p className="text-xs text-slate-500">
            Saving this marks the entry resolved and stops the clock on days to
            resolve.
          </p>
        </div>
      ) : null}

      {goesBlue ? (
        <p className="rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-800 ring-1 ring-inset ring-sky-200">
          This entry will be reassigned to {projectManagerName} for practice
          coordination after saving.
        </p>
      ) : null}

      {/*
        Hand-over on demand. Blue statuses already do this by themselves, so
        the checkbox is redundant there and says so rather than pretending to
        be the thing that caused it.
      */}
      <div className="rounded-lg border border-slate-200 px-3 py-2.5">
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={reassignToPm || goesBlue}
            disabled={goesBlue || saving}
            onChange={(event) => setReassignToPm(event.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
          />
          <span>Reassign to Practice PM after saving</span>
        </label>

        {goesBlue ? (
          <p className="mt-1 pl-6 text-xs text-slate-500">
            This status already reassigns the entry.
          </p>
        ) : reassignToPm ? (
          <p className="mt-1 pl-6 text-xs text-slate-600">
            {hasPrimaryPm
              ? `Entry will be reassigned to ${projectManagerName} upon saving`
              : `No PM assigned to this practice — reassign will go to ${projectManagerName}`}
          </p>
        ) : null}
      </div>

      {error ? <FieldError>{error}</FieldError> : null}

      <div className="flex justify-end">
        <Button type="submit" disabled={saving}>
          {saving ? (
            <>
              <SpinnerIcon className="h-4 w-4 animate-spin" />
              Saving…
            </>
          ) : (
            "Save note"
          )}
        </Button>
      </div>
    </form>
  );
}
