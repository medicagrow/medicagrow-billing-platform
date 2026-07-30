"use client";

import { useState } from "react";
import { StatusBadge } from "@/components/ar/StatusBadge";
import type { StatusCategory } from "@/lib/generated/prisma/enums";
import { formatDate, formatUSD } from "@/lib/format";

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export interface PriorRecord {
  id: string;
  reportMonth: number;
  reportYear: number;
  dateOfService: string;
  patientName: string;
  insuranceName: string;
  balance: string;
  statusLabel: string;
  statusCategory: StatusCategory;
  notes: {
    id: string;
    generatedNote: string;
    additionalNotes: string | null;
    outcomeType: string;
    workedByName: string;
    workedAt: string;
  }[];
}

/**
 * Read-only reference (spec §7.4): matching claims from closed batches for the
 * same practice. Nothing here is merged into the current claim.
 */
export function PriorHistoryPanel({ records }: { records: PriorRecord[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-card">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        disabled={records.length === 0}
        className="flex w-full items-center justify-between px-4 py-3 text-left disabled:cursor-default"
      >
        <span className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-900">
            Prior History
          </span>
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${
              records.length > 0
                ? "bg-brand-50 text-brand-700 ring-brand-200"
                : "bg-slate-100 text-slate-500 ring-slate-200"
            }`}
          >
            {records.length > 0
              ? `${records.length} prior record${records.length === 1 ? "" : "s"} found`
              : "No prior history"}
          </span>
        </span>
        {records.length > 0 ? (
          <span className="text-xs text-slate-400">{open ? "Hide" : "Show"}</span>
        ) : null}
      </button>

      {open && records.length > 0 ? (
        <div className="space-y-3 border-t border-slate-100 px-4 py-3">
          {records.map((record) => (
            <div
              key={record.id}
              className="rounded-lg border border-slate-200 bg-slate-50/60 p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-slate-700">
                  {MONTH_NAMES[record.reportMonth - 1]} {record.reportYear} ·{" "}
                  {formatDate(record.dateOfService)} ·{" "}
                  {formatUSD(record.balance)}
                </span>
                <StatusBadge
                  label={record.statusLabel}
                  category={record.statusCategory}
                />
              </div>

              {record.notes.length === 0 ? (
                <p className="mt-2 text-xs text-slate-500">
                  No work notes were logged on this prior claim.
                </p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {record.notes.map((note) => (
                    <li key={note.id} className="rounded bg-white p-2 ring-1 ring-slate-200">
                      <p className="font-mono text-[11px] leading-relaxed text-slate-700">
                        {note.generatedNote}
                      </p>
                      {note.additionalNotes ? (
                        <p className="mt-1 text-[11px] italic text-slate-500">
                          {note.additionalNotes}
                        </p>
                      ) : null}
                      <p className="mt-1 text-[10px] text-slate-400">
                        {note.workedByName} · {formatDate(note.workedAt)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
