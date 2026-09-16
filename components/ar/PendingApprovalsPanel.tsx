"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/ar/StatusBadge";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { FieldError, Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/toast";
import {
  announceClaimsChanged,
  CLAIMS_CHANGED_EVENT,
} from "@/lib/ar/claims-changed";
import { formatUSD } from "@/lib/format";
import type { StatusCategory } from "@/lib/generated/prisma/enums";
import { formatDateTimeIST } from "@/lib/timezone";

type ItemStatus = "PENDING" | "APPROVED" | "REJECTED";

interface RequestItem {
  claimId: string;
  itemStatus: ItemStatus;
  rejectionNote: string | null;
  patientName: string;
  insuranceName: string;
  currentStatus: string;
  currentCategory: StatusCategory;
  balance: string;
  agingDays: number;
}

interface StatusRequestRow {
  id: string;
  requestedStatus: string;
  requestedCategory: StatusCategory;
  note: string;
  status: "PENDING" | "PARTIALLY_APPROVED";
  createdAt: string;
  requestedByName: string;
  pendingCount: number;
  items: RequestItem[];
}

/**
 * Status changes billers have asked for, waiting on a manager.
 *
 * Reviewed **claim by claim**: a request covering twenty claims where two were
 * miscoded is approved for eighteen and rejected for two, rather than bounced
 * whole and resubmitted.
 */
export function PendingApprovalsPanel({ batchId }: { batchId: string }) {
  const router = useRouter();

  const [requests, setRequests] = useState<StatusRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<StatusRequestRow | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/ar/status-requests?batchId=${batchId}`);
      if (response.ok) {
        const payload = await response.json();
        setRequests(payload.data);
      }
    } finally {
      setLoading(false);
    }
  }, [batchId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    window.addEventListener(CLAIMS_CHANGED_EVENT, load);
    return () => window.removeEventListener(CLAIMS_CHANGED_EVENT, load);
  }, [load]);

  if (loading || requests.length === 0) return null;

  const pendingClaims = requests.reduce((sum, entry) => sum + entry.pendingCount, 0);

  return (
    <div
      id="pending-approvals"
      className="mb-5 rounded-xl border border-amber-200 bg-white shadow-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-100 bg-amber-50/60 px-4 py-3">
        <h3 className="text-sm font-semibold text-amber-900">
          ⏳ Pending approvals
        </h3>
        <p className="text-xs text-amber-800">
          {requests.length} request{requests.length === 1 ? "" : "s"} ·{" "}
          {pendingClaims} claim{pendingClaims === 1 ? "" : "s"} waiting
        </p>
      </div>

      <ul className="divide-y divide-slate-100">
        {requests.map((entry) => {
          const open = expanded === entry.id;

          return (
            <li key={entry.id} className="px-4 py-3">
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-slate-900">
                      {entry.requestedByName}
                    </span>
                    <span className="text-xs text-slate-500">
                      {formatDateTimeIST(entry.createdAt)}
                    </span>
                    <span className="text-xs text-slate-500">→</span>
                    <StatusBadge
                      label={entry.requestedStatus}
                      category={entry.requestedCategory}
                    />
                    {entry.status === "PARTIALLY_APPROVED" ? (
                      <Badge variant="sky">Partially approved</Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 text-slate-600">{entry.note}</p>
                  <button
                    type="button"
                    onClick={() => setExpanded(open ? null : entry.id)}
                    className="mt-1 text-xs font-medium text-slate-500 hover:text-slate-800"
                  >
                    {open ? "Hide" : "Show"} {entry.items.length} claim
                    {entry.items.length === 1 ? "" : "s"} · {entry.pendingCount}{" "}
                    pending
                  </button>
                </div>

                <Button
                  onClick={() => setReviewing(entry)}
                  className="px-3 py-1.5 text-xs"
                >
                  Review
                </Button>
              </div>

              {open ? (
                <ul className="mt-2 space-y-1 rounded-lg bg-slate-50 p-2 text-xs">
                  {entry.items.map((item) => (
                    <li key={item.claimId} className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-slate-800">
                        {item.patientName}
                      </span>
                      <span className="text-slate-500">{item.insuranceName}</span>
                      <StatusBadge
                        label={item.currentStatus}
                        category={item.currentCategory}
                      />
                      {item.itemStatus !== "PENDING" ? (
                        <Badge variant={item.itemStatus === "APPROVED" ? "brand" : "red"}>
                          {item.itemStatus === "APPROVED" ? "Approved" : "Rejected"}
                        </Badge>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>

      {reviewing ? (
        <ReviewRequestModal
          request={reviewing}
          onClose={() => setReviewing(null)}
          onReviewed={async () => {
            setReviewing(null);
            announceClaimsChanged();
            await load();
            // The header's pending count is server-rendered.
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function ReviewRequestModal({
  request,
  onClose,
  onReviewed,
}: {
  request: StatusRequestRow;
  onClose: () => void;
  onReviewed: () => void;
}) {
  const { toast } = useToast();

  const pending = useMemo(
    () => request.items.filter((item) => item.itemStatus === "PENDING"),
    [request.items],
  );

  // Everything pending starts ticked — approving the lot is the common case.
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(pending.map((item) => item.claimId)),
  );
  const [rejectionNote, setRejectionNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allChecked = pending.length > 0 && checked.size === pending.length;

  async function decide(
    decision: "APPROVED" | "REJECTED",
    claimIds: string[],
  ) {
    setError(null);

    if (claimIds.length === 0) {
      setError("Tick at least one claim.");
      return;
    }

    setSaving(true);

    try {
      const response = await fetch(
        `/api/ar/status-requests/${request.id}/review`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: claimIds.map((claimId) => ({
              claimId,
              decision,
              ...(decision === "REJECTED" && rejectionNote.trim()
                ? { rejectionNote: rejectionNote.trim() }
                : {}),
            })),
          }),
        },
      );

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setError(payload?.error ?? "Could not save the review.");
        return;
      }

      toast(
        decision === "APPROVED"
          ? `Approved ${payload.approved} claim${payload.approved === 1 ? "" : "s"}` +
              (payload.remaining > 0 ? ` · ${payload.remaining} still pending` : "")
          : `Rejected ${payload.rejected} claim${payload.rejected === 1 ? "" : "s"}` +
              (payload.remaining > 0 ? ` · ${payload.remaining} still pending` : ""),
      );

      onReviewed();
    } catch {
      setError("Could not save the review. Check your connection.");
    } finally {
      setSaving(false);
    }
  }

  const selected = pending
    .filter((item) => checked.has(item.claimId))
    .map((item) => item.claimId);

  const everyPending = pending.map((item) => item.claimId);

  return (
    <Modal
      open
      wide
      onClose={() => (saving ? undefined : onClose())}
      title={`Review: change to “${request.requestedStatus}”`}
      description={`Requested by ${request.requestedByName} · ${pending.length} of ${request.items.length} claims still pending`}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => decide("APPROVED", everyPending)}
              disabled={saving || pending.length === 0}
              className="px-3 py-1.5 text-xs"
            >
              Approve all
            </Button>
            <Button
              variant="secondary"
              onClick={() => decide("REJECTED", everyPending)}
              disabled={saving || pending.length === 0}
              className="px-3 py-1.5 text-xs"
            >
              Reject all
            </Button>
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => decide("REJECTED", selected)}
              disabled={saving}
            >
              Reject selected ({selected.length})
            </Button>
            <Button
              onClick={() => decide("APPROVED", selected)}
              disabled={saving}
            >
              {saving ? "Saving…" : `Approve selected (${selected.length})`}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        {error ? <FieldError>{error}</FieldError> : null}

        <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
          “{request.note}”
        </p>

        <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-slate-200">
          <table className="w-full text-xs">
            <thead className="sticky top-0 border-b border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="w-8 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={() =>
                      setChecked(allChecked ? new Set() : new Set(everyPending))
                    }
                    aria-label="Select every pending claim"
                    className="h-4 w-4 rounded border-slate-300"
                  />
                </th>
                <th className="px-3 py-2">Patient</th>
                <th className="px-3 py-2">Current status</th>
                <th className="px-3 py-2">Requested</th>
                <th className="px-3 py-2 text-right">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {request.items.map((item) => {
                const decided = item.itemStatus !== "PENDING";

                return (
                  <tr key={item.claimId} className={decided ? "opacity-50" : ""}>
                    <td className="px-3 py-1.5">
                      {decided ? (
                        <Badge variant={item.itemStatus === "APPROVED" ? "brand" : "red"}>
                          {item.itemStatus === "APPROVED" ? "✓" : "✕"}
                        </Badge>
                      ) : (
                        <input
                          type="checkbox"
                          checked={checked.has(item.claimId)}
                          onChange={() =>
                            setChecked((current) => {
                              const next = new Set(current);
                              if (next.has(item.claimId)) next.delete(item.claimId);
                              else next.add(item.claimId);
                              return next;
                            })
                          }
                          aria-label={`Select ${item.patientName}`}
                          className="h-4 w-4 rounded border-slate-300"
                        />
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-slate-800">
                      {item.patientName}
                      <span className="block text-slate-400">{item.insuranceName}</span>
                    </td>
                    <td className="px-3 py-1.5">
                      <StatusBadge
                        label={item.currentStatus}
                        category={item.currentCategory}
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <StatusBadge
                        label={request.requestedStatus}
                        category={request.requestedCategory}
                      />
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-700">
                      {formatUSD(item.balance)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="space-y-1">
          <label
            htmlFor="rejection-note"
            className="block text-xs font-medium text-slate-600"
          >
            Rejection note (optional — sent with any rejection)
          </label>
          <Input
            id="rejection-note"
            value={rejectionNote}
            onChange={(event) => setRejectionNote(event.target.value)}
            maxLength={1000}
            placeholder="Why this change is not right"
            disabled={saving}
          />
        </div>
      </div>
    </Modal>
  );
}
