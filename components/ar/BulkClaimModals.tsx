"use client";

import { useState } from "react";
import { QuickUpdateForm } from "@/components/ar/QuickUpdateForm";
import { StatusBadge } from "@/components/ar/StatusBadge";
import { Button } from "@/components/ui/Button";
import { FieldError, Input, Label } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Textarea } from "@/components/ui/Select";
import { useToast } from "@/components/ui/toast";
import type { ClaimDto } from "@/lib/ar-serialize";
import { announceClaimsChanged } from "@/lib/ar/claims-changed";

const PREVIEW_PAGE_SIZE = 8;

/** The claims a bulk action is about to touch, a page at a time. */
function SelectionPreview({ claims }: { claims: ClaimDto[] }) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(claims.length / PREVIEW_PAGE_SIZE));
  const visible = claims.slice(
    page * PREVIEW_PAGE_SIZE,
    (page + 1) * PREVIEW_PAGE_SIZE,
  );

  return (
    <div className="rounded-lg border border-slate-200">
      <table className="w-full text-xs">
        <thead className="border-b border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-3 py-2">Patient</th>
            <th className="px-3 py-2">Current status</th>
            <th className="px-3 py-2">Insurance</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {visible.map((claim) => (
            <tr key={claim.id}>
              <td className="px-3 py-1.5 text-slate-800">{claim.patientName}</td>
              <td className="px-3 py-1.5">
                <StatusBadge
                  label={claim.statusLabel}
                  category={claim.statusCategory}
                />
              </td>
              <td className="px-3 py-1.5 text-slate-600">{claim.insuranceName}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {pages > 1 ? (
        <div className="flex items-center justify-between border-t border-slate-100 px-3 py-1.5 text-[11px] text-slate-500">
          <button
            type="button"
            onClick={() => setPage((current) => Math.max(0, current - 1))}
            disabled={page === 0}
            className="font-medium hover:text-slate-800 disabled:text-slate-300"
          >
            ← Previous
          </button>
          <span>
            Page {page + 1} of {pages}
          </span>
          <button
            type="button"
            onClick={() => setPage((current) => Math.min(pages - 1, current + 1))}
            disabled={page === pages - 1}
            className="font-medium hover:text-slate-800 disabled:text-slate-300"
          >
            Next →
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * One status and one reason across every selected claim. A biller's becomes a
 * single request a manager reviews claim by claim; a manager's applies now.
 */
export function BulkUpdateModal({
  claims,
  isManager,
  onClose,
  onDone,
}: {
  claims: ClaimDto[];
  isManager: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  return (
    <Modal
      open
      onClose={onClose}
      title="Update selected claims"
      description={`This update will apply to ${claims.length} claims.`}
      wide
    >
      <div className="space-y-4">
        <SelectionPreview claims={claims} />
        <QuickUpdateForm
          claimIds={claims.map((claim) => claim.id)}
          isManager={isManager}
          idPrefix="bulk-update"
          onCancel={onClose}
          onSubmitted={onDone}
        />
      </div>
    </Modal>
  );
}

/**
 * One follow-up date on every selected claim, applied at once.
 *
 * No approval: a follow-up date is scheduling, not a verdict on the claim.
 */
export function BulkFollowUpModal({
  claims,
  onClose,
  onDone,
}: {
  claims: ClaimDto[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();

  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (!date) return setError("Choose a follow-up date.");

    setSaving(true);

    try {
      const response = await fetch("/api/ar/claims/bulk-follow-up", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          claimIds: claims.map((claim) => claim.id),
          followUpDate: date,
          note: note.trim() || undefined,
        }),
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setError(payload?.error ?? "Could not set the follow-up date.");
        return;
      }

      toast(`Follow-up date set on ${payload.updated} claims`);
      announceClaimsChanged();
      onDone();
    } catch {
      setError("Could not set the follow-up date. Check your connection.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={() => (saving ? undefined : onClose())}
      title="Set follow-up date"
      description={`Applies to ${claims.length} claims, immediately.`}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? "Saving…" : "Set date"}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {error ? <FieldError>{error}</FieldError> : null}

        <div className="space-y-1.5">
          <Label htmlFor="bulk-follow-up-date">Follow-up date</Label>
          <Input
            id="bulk-follow-up-date"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            disabled={saving}
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="bulk-follow-up-note">Note (optional)</Label>
          <Textarea
            id="bulk-follow-up-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            maxLength={1000}
            disabled={saving}
          />
        </div>

        <SelectionPreview claims={claims} />
      </div>
    </Modal>
  );
}
