"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AgingBadge } from "@/components/ar/AgingBadge";
import { QuickUpdateForm } from "@/components/ar/QuickUpdateForm";
import { StatusBadge } from "@/components/ar/StatusBadge";
import { Badge } from "@/components/ui/Badge";
import type { ClaimDto } from "@/lib/ar-serialize";
import { CLAIMS_CHANGED_EVENT } from "@/lib/ar/claims-changed";
import { formatDate, formatUSD } from "@/lib/format";
import type { StatusCategory } from "@/lib/generated/prisma/enums";
import { formatDateTimeIST } from "@/lib/timezone";

interface NoteRow {
  id: string;
  workedAt: string;
  workedByName: string;
  generatedNote: string;
  additionalNotes: string | null;
  statusChangedTo: string;
  statusCategoryChangedTo: StatusCategory;
}

/** The note a person reads: their own words when they left any. */
const noteText = (note: NoteRow) =>
  note.additionalNotes?.trim()
    ? `${note.generatedNote} ${note.additionalNotes.trim()}`
    : note.generatedNote;

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-1">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right text-slate-900">{children}</dd>
    </div>
  );
}

/**
 * A claim opened in place, under its row.
 *
 * Most follow-up is "call, change the status, say why, next claim", and the
 * full claim page costs a navigation and a back button for each one. This
 * keeps the biller on the list with their filters and scroll position intact;
 * the full page is one link away for anything the quick form cannot say.
 */
export function ClaimQuickPanel({
  claim,
  isManager,
  batchClosed,
  onSubmitted,
}: {
  claim: ClaimDto & { pendingStatus?: string | null };
  isManager: boolean;
  batchClosed: boolean;
  onSubmitted: () => void;
}) {
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [noteTotal, setNoteTotal] = useState(0);
  const [loadingNotes, setLoadingNotes] = useState(true);
  const [showFullNote, setShowFullNote] = useState(false);

  const loadNotes = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/ar/work-notes?claimId=${claim.id}&limit=3`,
      );

      if (response.ok) {
        const payload = await response.json();
        setNotes(payload.data);
        setNoteTotal(payload.total);
      }
    } finally {
      setLoadingNotes(false);
    }
  }, [claim.id]);

  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  // A note saved here, or an approval elsewhere, should show up in the log.
  useEffect(() => {
    window.addEventListener(CLAIMS_CHANGED_EVENT, loadNotes);
    return () => window.removeEventListener(CLAIMS_CHANGED_EVENT, loadNotes);
  }, [loadNotes]);

  const lastNote = notes[0];

  return (
    <div className="grid gap-5 bg-slate-50/80 px-4 py-4 lg:grid-cols-5">
      {/* Left — what the claim is. */}
      <div className="space-y-3 text-xs lg:col-span-2">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge label={claim.statusLabel} category={claim.statusCategory} />
          <AgingBadge days={claim.agingDays} />
          {claim.pendingStatus ? (
            <Badge variant="amber">⏳ {claim.pendingStatus} pending</Badge>
          ) : null}
        </div>

        <dl className="divide-y divide-slate-200/70 rounded-lg bg-white px-3 py-1 ring-1 ring-inset ring-slate-200">
          <Detail label="Patient">{claim.patientName}</Detail>
          <Detail label="Insurance">{claim.insuranceName}</Detail>
          <Detail label="DOS">{formatDate(claim.dateOfService)}</Detail>
          <Detail label="Balance">
            <span className="font-medium tabular-nums">
              {formatUSD(claim.balance)}
            </span>
          </Detail>
          <Detail label="Aging">{claim.agingDays} days</Detail>
          {claim.cptCode ? <Detail label="CPT">{claim.cptCode}</Detail> : null}
          {claim.visitId ? <Detail label="Visit ID">{claim.visitId}</Detail> : null}
          {claim.visitStatus ? (
            <Detail label="Visit status">{claim.visitStatus}</Detail>
          ) : null}
          <Detail label="Provider">
            {claim.renderingProvider ?? claim.providerName ?? "—"}
          </Detail>
          <Detail label="Assigned to">
            {claim.assignedToName ?? <Badge variant="amber">Unassigned</Badge>}
          </Detail>
        </dl>

        <div className="rounded-lg bg-white px-3 py-2 ring-1 ring-inset ring-slate-200">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
            Last work note
          </p>
          {loadingNotes ? (
            <p className="mt-1 text-slate-400">Loading…</p>
          ) : lastNote ? (
            <>
              <p className={`mt-1 text-slate-700 ${showFullNote ? "" : "line-clamp-2"}`}>
                {noteText(lastNote)}
              </p>
              <button
                type="button"
                onClick={() => setShowFullNote((current) => !current)}
                className="mt-1 font-medium text-brand-700 hover:text-brand-800"
              >
                {showFullNote ? "Show less" : "Show more"}
              </button>
            </>
          ) : (
            <p className="mt-1 text-slate-400">Not worked yet.</p>
          )}
        </div>

        <Link
          href={`/ar/claims/${claim.id}`}
          className="inline-block font-medium text-brand-700 hover:text-brand-800"
        >
          View full claim →
        </Link>
      </div>

      {/* Right — change it, and see what has been done. */}
      <div className="space-y-4 lg:col-span-3">
        <div className="rounded-lg bg-white p-3 ring-1 ring-inset ring-slate-200">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">
            Quick update
          </p>
          {batchClosed ? (
            <p className="text-xs text-slate-500">
              This batch is closed and read-only.
            </p>
          ) : claim.pendingStatus && !isManager ? (
            <p className="text-xs text-amber-800">
              A change to “{claim.pendingStatus}” is already awaiting PM
              approval for this claim.
            </p>
          ) : (
            <QuickUpdateForm
              claimIds={[claim.id]}
              isManager={isManager}
              idPrefix={`quick-${claim.id}`}
              onSubmitted={onSubmitted}
            />
          )}
        </div>

        <div className="rounded-lg bg-white p-3 ring-1 ring-inset ring-slate-200">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Work log
            </p>
            {noteTotal > notes.length ? (
              <Link
                href={`/ar/claims/${claim.id}`}
                className="text-xs font-medium text-brand-700 hover:text-brand-800"
              >
                View all {noteTotal} →
              </Link>
            ) : null}
          </div>

          {loadingNotes ? (
            <p className="text-xs text-slate-400">Loading…</p>
          ) : notes.length === 0 ? (
            <p className="text-xs text-slate-400">No notes yet.</p>
          ) : (
            <ul className="space-y-2">
              {notes.map((note) => (
                <li key={note.id} className="text-xs">
                  <div className="flex flex-wrap items-center gap-2 text-slate-500">
                    <span className="font-medium text-slate-700">
                      {note.workedByName}
                    </span>
                    <span>{formatDateTimeIST(note.workedAt)}</span>
                    <StatusBadge
                      label={note.statusChangedTo}
                      category={note.statusCategoryChangedTo}
                    />
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-slate-700">
                    {noteText(note)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
