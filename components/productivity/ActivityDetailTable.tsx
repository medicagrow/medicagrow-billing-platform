"use client";

import Link from "next/link";
import { StatusBadge } from "@/components/ar/StatusBadge";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/Card";
import { OUTCOME_LABELS } from "@/lib/ar-outcomes";
import { downloadCsv } from "@/lib/csv-export";
import { formatDate, formatUSD } from "@/lib/format";
import type { OutcomeType, StatusCategory } from "@/lib/generated/prisma/enums";
import { AR_ACTIVITIES } from "@/lib/productivity/ar-activities";

export interface DetailRow {
  claimId: string;
  patientName: string;
  insuranceName: string;
  dateOfService: string;
  practiceName: string;
  reportMonth: number;
  reportYear: number;
  statusLabel: string;
  statusCategory: StatusCategory;
  balance: string;
  noteDate: string;
  outcomeType: OutcomeType;
  statusChangedTo: string;
  denialReason: string | null;
  actionTaken: string | null;
}

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function ActivityDetailTable({
  activityKey,
  label,
  rows,
  billerName,
  from,
  to,
}: {
  activityKey: string;
  label: string;
  rows: DetailRow[];
  billerName: string;
  from: string;
  to: string;
}) {
  // Columns vary by activity: green adds a completion date, denials add the
  // denial reason and what was done about it.
  const showMovedToGreen = activityKey === AR_ACTIVITIES.MOVED_TO_GREEN;
  const showDenialColumns = activityKey === AR_ACTIVITIES.DENIALS_WORKED;

  function handleExport() {
    downloadCsv(
      `${billerName.replace(/\s+/g, "-").toLowerCase()}-${activityKey}-${from}-to-${to}.csv`,
      [
        "Patient Name",
        "Insurance",
        "Date of Service",
        "Practice",
        "Batch Month",
        "Status",
        "Note Date",
        "Note Type",
        "Balance",
        ...(showMovedToGreen ? ["Moved to Green On"] : []),
        ...(showDenialColumns ? ["Denial Reason", "Action Taken"] : []),
      ],
      rows.map((row) => [
        row.patientName,
        row.insuranceName,
        formatDate(row.dateOfService),
        row.practiceName,
        `${MONTH_NAMES[row.reportMonth - 1]} ${row.reportYear}`,
        row.statusLabel,
        formatDate(row.noteDate),
        OUTCOME_LABELS[row.outcomeType],
        row.balance,
        ...(showMovedToGreen ? [formatDate(row.noteDate)] : []),
        ...(showDenialColumns ? [row.denialReason ?? "", row.actionTaken ?? ""] : []),
      ]),
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        title={`No ${label.toLowerCase()} in this period`}
        description="Try a wider date range."
      />
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-card">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-900">
          {rows.length} record{rows.length === 1 ? "" : "s"} on this page
        </h3>
        <Button
          variant="secondary"
          className="px-3 py-2 text-xs"
          onClick={handleExport}
        >
          Export CSV
        </Button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1100px] text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Patient</th>
              <th className="px-4 py-3">Insurance</th>
              <th className="px-4 py-3">DOS</th>
              <th className="px-4 py-3">Practice</th>
              <th className="px-4 py-3">Batch</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Note date</th>
              <th className="px-4 py-3">Note type</th>
              {showMovedToGreen ? (
                <th className="px-4 py-3">Moved to green</th>
              ) : null}
              {showDenialColumns ? (
                <>
                  <th className="px-4 py-3">Denial reason</th>
                  <th className="px-4 py-3">Action taken</th>
                </>
              ) : null}
              <th className="px-4 py-3 text-right">Balance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row, index) => (
              <tr key={`${row.claimId}-${index}`} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <Link
                    href={`/ar/claims/${row.claimId}`}
                    className="font-medium text-slate-900 hover:text-brand-700"
                  >
                    {row.patientName}
                  </Link>
                </td>
                <td className="px-4 py-3 text-slate-600">{row.insuranceName}</td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                  {formatDate(row.dateOfService)}
                </td>
                <td className="px-4 py-3 text-slate-600">{row.practiceName}</td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                  {MONTH_NAMES[row.reportMonth - 1]} {row.reportYear}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge
                    label={row.statusLabel}
                    category={row.statusCategory}
                  />
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                  {formatDate(row.noteDate)}
                </td>
                <td className="px-4 py-3">
                  <Badge variant="neutral">
                    {OUTCOME_LABELS[row.outcomeType]}
                  </Badge>
                </td>
                {showMovedToGreen ? (
                  <td className="whitespace-nowrap px-4 py-3 text-emerald-700">
                    {formatDate(row.noteDate)}
                  </td>
                ) : null}
                {showDenialColumns ? (
                  <>
                    <td className="px-4 py-3 text-slate-600">
                      {row.denialReason ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {row.actionTaken ?? "—"}
                    </td>
                  </>
                ) : null}
                <td className="px-4 py-3 text-right tabular-nums text-slate-900">
                  {formatUSD(row.balance)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
