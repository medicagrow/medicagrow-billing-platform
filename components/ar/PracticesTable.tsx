"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/Card";
import {
  UploadBatchModal,
  type PracticeOption,
} from "@/components/ar/UploadBatchModal";
import { EHR_SOURCE_LABELS } from "@/lib/ehr-labels";
import { formatUSD } from "@/lib/format";
import type { EhrSource } from "@/lib/generated/prisma/enums";

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export interface PracticeRow {
  id: string;
  name: string;
  ehrSource: EhrSource;
  batchId: string | null;
  reportMonth: number | null;
  reportYear: number | null;
  status: string | null;
  totalClaims: number;
  totalBalance: string;
  percentComplete: number;
  daysOpen: number | null;
  unassignedCount: number;
}

export function PracticesTable({
  practices,
  canUpload,
}: {
  practices: PracticeRow[];
  canUpload: boolean;
}) {
  const [uploadFor, setUploadFor] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const options: PracticeOption[] = practices.map((practice) => ({
    id: practice.id,
    name: practice.name,
    hasOpenBatch: practice.status === "OPEN",
  }));

  if (practices.length === 0) {
    return (
      <EmptyState
        title="No practices yet"
        description="Add practices in Settings before uploading AR batches."
      />
    );
  }

  return (
    <>
      {canUpload ? (
        <div className="mb-4 flex flex-wrap justify-end gap-2">
          <a
            href="/templates/ar-claims-template.csv"
            download
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-white px-3.5 py-2 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-300 transition-colors hover:bg-slate-50"
          >
            Download CSV Template
          </a>
          <Button
            onClick={() => {
              setUploadFor(null);
              setModalOpen(true);
            }}
          >
            Upload Batch
          </Button>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-card">
        <table className="w-full min-w-[880px] text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Practice</th>
              <th className="px-4 py-3">EHR</th>
              <th className="px-4 py-3">Current batch</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Claims</th>
              <th className="px-4 py-3 text-right">Balance</th>
              <th className="px-4 py-3 text-right">Complete</th>
              <th className="px-4 py-3 text-right">Days open</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {practices.map((practice) => (
              <tr key={practice.id} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <Link
                    href={`/ar/practices/${practice.id}`}
                    className="font-medium text-slate-900 hover:text-brand-700"
                  >
                    {practice.name}
                  </Link>
                  {practice.unassignedCount > 0 ? (
                    <Badge variant="amber" className="ml-2">
                      {practice.unassignedCount} unassigned
                    </Badge>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {EHR_SOURCE_LABELS[practice.ehrSource]}
                </td>
                <td className="px-4 py-3 text-slate-600">
                  {practice.reportMonth && practice.reportYear ? (
                    <Link
                      href={`/ar/batches/${practice.batchId}`}
                      className="hover:text-brand-700"
                    >
                      {MONTH_NAMES[practice.reportMonth - 1]}{" "}
                      {practice.reportYear}
                    </Link>
                  ) : (
                    <span className="text-slate-400">No active batch</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {practice.status ? (
                    <Badge
                      variant={practice.status === "OPEN" ? "brand" : "neutral"}
                    >
                      {practice.status === "OPEN" ? "Open" : "Closed"}
                    </Badge>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                  {practice.totalClaims || "—"}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-900">
                  {practice.batchId ? formatUSD(practice.totalBalance) : "—"}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                  {practice.batchId ? `${practice.percentComplete}%` : "—"}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {practice.daysOpen === null ? (
                    <span className="text-slate-400">—</span>
                  ) : (
                    <span
                      className={
                        practice.daysOpen > 60
                          ? "font-medium text-amber-700"
                          : "text-slate-700"
                      }
                    >
                      {practice.daysOpen}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  {canUpload && practice.status !== "OPEN" ? (
                    <Button
                      variant="secondary"
                      className="px-2.5 py-1 text-xs"
                      onClick={() => {
                        setUploadFor(practice.id);
                        setModalOpen(true);
                      }}
                    >
                      Upload
                    </Button>
                  ) : practice.batchId ? (
                    <Link
                      href={`/ar/batches/${practice.batchId}`}
                      className="text-xs font-medium text-brand-700 hover:text-brand-800"
                    >
                      View batch
                    </Link>
                  ) : (
                    <span className="text-xs text-slate-400">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canUpload ? (
        <UploadBatchModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          practices={options}
          initialPracticeId={uploadFor ?? undefined}
        />
      ) : null}
    </>
  );
}
